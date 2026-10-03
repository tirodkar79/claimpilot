import { ConsoleLogger, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { MastraModelConfig } from '@mastra/core/llm';
import type { Model } from 'mongoose';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { LANGUAGE_MODEL } from '../agents/language-model.provider';
import { AppModule } from '../app.module';
import { Claim } from '../claims/claim.schema';
import { ClaimTriageService } from '../claims/claim-triage.service';
import { ClaimsRepository } from '../claims/claims.repository';
import { localDate } from '../common/utils/local-date';
import { EnvConfig } from '../config/env.validation';
import { MongoModule } from '../mongo/mongo.module';
import { TraceEvent } from '../trace/trace-event.schema';
import { TraceRepository } from '../trace/trace.repository';
import { OpenMeteoMcpService } from '../weather/open-meteo-mcp.service';
import { scenarioCases } from './eval-cases';
import { findRegressions, summariseRun } from './eval-metrics';
import { EvalRunner } from './eval-runner';
import { EvalRunsRepository } from './eval-runs.repository';
import { EvalWeatherStub } from './eval-weather.stub';
import {
    BASELINE_FILE,
    EVAL_DATABASE,
    EVALS_DIR,
    REPORT_FILE,
    REVIEWED_CASES_DIR,
    type EvalCase,
    type EvalMetrics,
} from './evals.constants';
import { ExplanationJudge } from './explanation-judge';

/** Flights in the cases happened this many days ago: inside every active policy's cover and claim deadline. */
const FLIGHT_DAYS_AGO = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

const logger = new Logger('Evals');

/** The app's default connection pointed at the eval database, so eval claims never mix with real ones. */
@Module({
    imports: [
        MongooseModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService<EnvConfig, true>) => ({
                uri: config.get('MONGO_URI', { infer: true }),
                dbName: EVAL_DATABASE,
                serverSelectionTimeoutMS: 5000,
            }),
        }),
    ],
})
class EvalMongoModule {}

/** Cases exported from human reviews (`npm run eval:export-reviews`). */
function loadReviewedCases(): EvalCase[] {
    if (!existsSync(REVIEWED_CASES_DIR)) return [];
    return readdirSync(REVIEWED_CASES_DIR)
        .filter((file) => file.endsWith('.json'))
        .map((file) => JSON.parse(readFileSync(join(REVIEWED_CASES_DIR, file), 'utf8')) as EvalCase);
}

/**
 * Formats a 0–1 rate as a percentage.
 * @param value Rate.
 */
function percent(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
}

/**
 * Logs the headline metrics.
 * @param metrics Run metrics.
 */
function logMetrics(metrics: EvalMetrics): void {
    const lines = [
        `cases ${metrics.cases}, attempts ${metrics.attempts} (+${metrics.erroredAttempts} lost to provider errors), ` +
            `consistent ${metrics.consistentCases}, flaky ${metrics.flakyCases}`,
        `decision accuracy ${percent(metrics.decisionAccuracy)}, false approvals ${percent(metrics.falseApproveRate)}`,
        Object.entries(metrics.dimensionPassRates)
            .map(([dimension, value]) => `${dimension} ${percent(value)}`)
            .join(', '),
        `guard interventions ${metrics.guardInterventions}, average ${(metrics.averageDurationMs / 1000).toFixed(1)}s per claim`,
    ];
    if (metrics.reviewerAgreement !== null) lines.push(`reviewer agreement ${percent(metrics.reviewerAgreement)}`);
    if (metrics.judge) {
        lines.push(
            `judge: clarity ${metrics.judge.clarity}, faithfulness ${metrics.judge.faithfulness}, tone ${metrics.judge.tone}`,
        );
    }
    lines.forEach((line) => logger.log(line));
}

/**
 * `npm run eval -- [--repeat 3] [--judge] [--case id,id] [--update-baseline]`
 * Runs the cases against the configured model, stores the run (shown in the web app), writes
 * `evals/report.json`, and exits non-zero when a metric regressed against `evals/baseline.json`.
 */
async function main(): Promise<void> {
    const { values } = parseArgs({
        options: {
            repeat: { type: 'string', default: '1' },
            judge: { type: 'boolean', default: false },
            case: { type: 'string' },
            'update-baseline': { type: 'boolean', default: false },
        },
    });
    const repeats = Math.max(1, Number(values.repeat) || 1);

    const weather = new EvalWeatherStub();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideModule(MongoModule)
        .useModule(EvalMongoModule)
        .overrideProvider(OpenMeteoMcpService)
        .useValue(weather)
        .compile();
    // Progress and metrics only; agent failures are in each claim's trace and the report.
    moduleRef.useLogger(new ConsoleLogger({ logLevels: ['log', 'warn'] }));
    const app = await moduleRef.init();

    try {
        const config = app.get(ConfigService<EnvConfig, true>);
        const { provider, modelId } = config.get('MODEL', { infer: true });
        const timeZone = config.get('CLAIMANT_TIMEZONE', { infer: true });
        const flightDate = localDate(new Date(Date.now() - FLIGHT_DAYS_AGO * DAY_MS), timeZone);

        const only = values.case?.split(',');
        const cases = [...scenarioCases(flightDate), ...loadReviewedCases()].filter(
            (evalCase) => !only || only.includes(evalCase.id),
        );
        logger.log(`Running ${cases.length} case(s) × ${repeats} on ${provider}:${modelId}`);

        const claimModel = app.get<Model<Claim>>(getModelToken(Claim.name));
        const traceModel = app.get<Model<TraceEvent>>(getModelToken(TraceEvent.name));
        const runner = new EvalRunner({
            claims: app.get(ClaimsRepository, { strict: false }),
            traces: app.get(TraceRepository, { strict: false }),
            triage: app.get(ClaimTriageService, { strict: false }),
            weather,
            reset: async () => {
                await Promise.all([claimModel.deleteMany({}), traceModel.deleteMany({})]);
            },
            judge: values.judge
                ? new ExplanationJudge(app.get<MastraModelConfig>(LANGUAGE_MODEL, { strict: false }))
                : undefined,
        });

        const startedAt = new Date();
        const results = await runner.run(cases, repeats);
        const metrics = summariseRun(results);
        // A partial run (--case) has different rates by construction, so only full runs are compared.
        const baseline =
            !only && existsSync(BASELINE_FILE)
                ? (JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as EvalMetrics)
                : undefined;
        const regressions = baseline ? findRegressions(metrics, baseline) : [];

        const run = await app.get(EvalRunsRepository).create({
            startedAt,
            finishedAt: new Date(),
            model: `${provider}:${modelId}`,
            repeats,
            judged: values.judge,
            metrics,
            regressions,
            comparedWithBaseline: !!baseline,
            cases: results,
        });

        mkdirSync(EVALS_DIR, { recursive: true });
        writeFileSync(REPORT_FILE, JSON.stringify({ runId: String(run._id), metrics, regressions, results }, null, 4));
        logMetrics(metrics);
        if (values['update-baseline'] && !only) {
            writeFileSync(BASELINE_FILE, `${JSON.stringify(metrics, null, 4)}\n`);
            logger.log(`Baseline updated: ${BASELINE_FILE}`);
        } else if (!baseline) {
            logger.warn('No baseline yet; run with --update-baseline to set one');
        }
        for (const regression of regressions) {
            logger.error(
                `Regression in ${regression.metric}: ${percent(regression.baseline)} → ${percent(regression.current)}`,
            );
        }
        logger.log(`Run ${String(run._id)} stored; report at ${REPORT_FILE}`);
        if (regressions.length && !values['update-baseline']) process.exitCode = 1;
    } finally {
        await app.close();
    }
}

void main();
