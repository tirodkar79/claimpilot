import { Logger } from '@nestjs/common';
import type { ClaimFacts } from '../claims/claim-facts';
import type { ClaimTriageService } from '../claims/claim-triage.service';
import type { ClaimsRepository } from '../claims/claims.repository';
import type { TraceEvent } from '../trace/trace-event.schema';
import type { TraceRepository } from '../trace/trace.repository';
import type { EvalAttempt, EvalCase, EvalCaseResult } from './evals.constants';
import { attemptPassed } from './eval-metrics';
import { countGuardInterventions, scoreAttempt } from './eval-scorers';
import type { EvalWeatherStub } from './eval-weather.stub';
import type { ExplanationJudge } from './explanation-judge';

/** Model-provider errors: an outage or quota limit, not the behaviour under test. */
const PROVIDER_ERROR = /quota|rate.?limit|exceeded|overloaded|high demand|\b(429|500|503)\b/i;

/**
 * The provider error that broke an attempt, if any agent failed for that reason.
 * @param events Claim trace.
 */
export function providerError(events: Pick<TraceEvent, 'type' | 'data'>[]): string | undefined {
    return events
        .filter((event) => event.type === 'agent.failed')
        .map((event) => String(event.data?.error ?? ''))
        .find((message) => PROVIDER_ERROR.test(message));
}

export interface EvalRunnerDeps {
    claims: ClaimsRepository;
    traces: TraceRepository;
    triage: ClaimTriageService;
    weather: EvalWeatherStub;
    /** Empties the eval database's claims and traces, so no case sees another's claims. */
    reset: () => Promise<void>;
    judge?: ExplanationJudge;
}

/**
 * Runs eval cases through the real triage pipeline (real model, recorded flights, stubbed weather), one at a
 * time, and grades each attempt from the stored claim and its trace.
 */
export class EvalRunner {
    private readonly logger = new Logger('Evals');

    constructor(private readonly deps: EvalRunnerDeps) {}

    /**
     * Runs every case `repeats` times.
     * @param cases Cases to run.
     * @param repeats Attempts per case (more attempts expose flaky behaviour).
     */
    async run(cases: EvalCase[], repeats: number): Promise<EvalCaseResult[]> {
        const results: EvalCaseResult[] = [];
        for (const evalCase of cases) {
            const attempts: EvalAttempt[] = [];
            for (let attempt = 1; attempt <= repeats; attempt++) {
                const result = await this.attempt(evalCase);
                attempts.push(result);
                const failed = result.checks.filter((check) => !check.pass).map((check) => check.name);
                this.logger.log(
                    `${attemptPassed(result) ? 'PASS' : 'FAIL'} ${evalCase.id} #${attempt} → ${result.decision ?? '-'}` +
                        (result.error ? ` (error: ${result.error})` : '') +
                        (failed.length ? ` (failed: ${failed.join(', ')})` : ''),
                );
            }
            results.push({
                id: evalCase.id,
                title: evalCase.title,
                tests: evalCase.tests,
                source: evalCase.source,
                expectedDecision: evalCase.expect.decision,
                attempts,
            });
        }
        return results;
    }

    /**
     * One attempt: fresh database, the case's prior claims and weather, triage, then grading.
     * @param evalCase Case to run.
     */
    private async attempt(evalCase: EvalCase): Promise<EvalAttempt> {
        const { claims, traces, triage, weather, reset, judge } = this.deps;
        await reset();
        weather.use(evalCase.weather);
        for (const prior of evalCase.priorClaims ?? []) {
            await claims.create({
                ...evalCase.input,
                message: 'Earlier claim for the same flight',
                status: 'completed',
                facts: { flightNumber: prior.flightNumber, flightDate: prior.flightDate } as ClaimFacts,
                outcome: { decision: prior.decision, reasons: [], citations: [] },
            });
        }

        const startedAt = Date.now();
        try {
            const created = await claims.create({
                ...evalCase.input,
                status: 'triaging',
                injectFailures: evalCase.injectFailures ?? [],
            });
            await triage.run(created);
            const durationMs = Date.now() - startedAt;
            const claim = (await claims.findById(String(created._id)))!;
            const events = await traces.findByClaim(String(created._id));
            const outage = providerError(events);
            return {
                ...(outage && { error: `Model provider error: ${outage}` }),
                decision: claim.outcome?.decision,
                payoutAmount: claim.outcome?.payout?.amount,
                reasons: claim.outcome?.reasons,
                checks: scoreAttempt(evalCase, claim, events),
                guardInterventions: countGuardInterventions(events),
                toolCalls: events.filter((event) => event.type === 'tool.called').length,
                durationMs,
                summary: claim.summary,
                judge:
                    judge && claim.outcome && !outage
                        ? await this.grade(judge, claim.outcome, claim.summary)
                        : undefined,
            };
        } catch (error) {
            return {
                checks: [],
                guardInterventions: 0,
                toolCalls: 0,
                durationMs: Date.now() - startedAt,
                error: (error as Error).message,
            };
        }
    }

    /**
     * Asks the judge for a score; a judge failure is logged and leaves the attempt unscored.
     * @param judge Explanation judge.
     * @param outcome Claim outcome.
     * @param summary Claim summary.
     */
    private async grade(judge: ExplanationJudge, ...[outcome, summary]: Parameters<ExplanationJudge['grade']>) {
        try {
            return await judge.grade(outcome, summary);
        } catch (error) {
            this.logger.warn(`Judge failed: ${(error as Error).message}`);
            return undefined;
        }
    }
}
