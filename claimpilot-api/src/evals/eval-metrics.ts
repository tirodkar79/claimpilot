import { CLAIM_DECISIONS } from '../claims/claims.constants';
import {
    EVAL_DIMENSIONS,
    type EvalAttempt,
    type EvalCaseResult,
    type EvalDimension,
    type EvalMetrics,
    type EvalRegression,
} from './evals.constants';

/** A rate may fall by this much (noise from a real model) before it counts as a regression. */
export const REGRESSION_TOLERANCE = 0.05;

/**
 * Share of items that satisfy a predicate; 1 when there are none (nothing failed).
 * @param items Items to count.
 * @param predicate Pass condition.
 */
function rate<T>(items: T[], predicate: (item: T) => boolean): number {
    return items.length ? items.filter(predicate).length / items.length : 1;
}

/**
 * Whether every check of an attempt passed.
 * @param attempt One triage run.
 */
export function attemptPassed(attempt: EvalAttempt): boolean {
    return !attempt.error && attempt.checks.every((check) => check.pass);
}

/**
 * Mean of the judge's scores over attempts it rated.
 * @param attempts All attempts.
 */
function judgeMeans(attempts: EvalAttempt[]): EvalMetrics['judge'] {
    const scores = attempts.flatMap((attempt) => (attempt.judge ? [attempt.judge] : []));
    if (!scores.length) return null;
    const mean = (key: 'clarity' | 'faithfulness' | 'tone') =>
        Math.round((scores.reduce((sum, score) => sum + score[key], 0) / scores.length) * 10) / 10;
    return { clarity: mean('clarity'), faithfulness: mean('faithfulness'), tone: mean('tone') };
}

/**
 * Aggregates case results into the run's headline metrics. Scenario cases make up the metrics; review cases
 * only feed reviewer agreement.
 * @param results Results of every case.
 */
export function summariseRun(results: EvalCaseResult[]): EvalMetrics {
    const scenarios = results.filter((result) => result.source === 'scenario');
    // Attempts broken by the model provider (quota, outage) say nothing about behaviour: counted, not scored.
    const allAttempts = scenarios.flatMap((result) =>
        result.attempts.map((attempt) => ({ ...attempt, expected: result.expectedDecision })),
    );
    const attempts = allAttempts.filter((attempt) => !attempt.error);
    const reviewAttempts = results
        .filter((result) => result.source === 'review')
        .flatMap((result) =>
            result.attempts.filter((attempt) => !attempt.error).map((a) => a.decision === result.expectedDecision),
        );

    const confusion: EvalMetrics['confusion'] = {};
    for (const expected of CLAIM_DECISIONS) {
        confusion[expected] = Object.fromEntries(CLAIM_DECISIONS.map((actual) => [actual, 0]));
    }
    for (const attempt of attempts) {
        if (attempt.decision) confusion[attempt.expected][attempt.decision] += 1;
    }

    const dimensionPassRates = Object.fromEntries(
        EVAL_DIMENSIONS.map((dimension) => {
            const checks = attempts.flatMap((attempt) => attempt.checks.filter((c) => c.dimension === dimension));
            return [dimension, rate(checks, (check) => check.pass)];
        }),
    ) as Record<EvalDimension, number>;

    const outcomes = scenarios
        .map((result) => result.attempts.filter((attempt) => !attempt.error).map(attemptPassed))
        .filter((passes) => passes.length);
    return {
        attempts: attempts.length,
        erroredAttempts: allAttempts.length - attempts.length,
        cases: scenarios.length,
        decisionAccuracy: rate(attempts, (attempt) => attempt.decision === attempt.expected),
        falseApproveRate: rate(
            attempts.filter((attempt) => attempt.expected !== 'APPROVE'),
            (attempt) => attempt.decision === 'APPROVE',
        ),
        dimensionPassRates,
        consistentCases: outcomes.filter((passes) => passes.every(Boolean)).length,
        flakyCases: outcomes.filter((passes) => passes.some(Boolean) && !passes.every(Boolean)).length,
        guardInterventions: attempts.reduce((sum, attempt) => sum + attempt.guardInterventions, 0),
        confusion,
        averageDurationMs: Math.round(
            attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0) / Math.max(1, attempts.length),
        ),
        reviewerAgreement: reviewAttempts.length ? rate(reviewAttempts, Boolean) : null,
        judge: judgeMeans(attempts),
    };
}

/**
 * Compares a run against the committed baseline. Any approval that shouldn't have been one is a regression;
 * other rates may drop by up to REGRESSION_TOLERANCE.
 * @param current This run's metrics.
 * @param baseline Baseline metrics.
 */
export function findRegressions(current: EvalMetrics, baseline: EvalMetrics): EvalRegression[] {
    const regressions: EvalRegression[] = [];
    if (current.falseApproveRate > baseline.falseApproveRate) {
        regressions.push({
            metric: 'falseApproveRate',
            baseline: baseline.falseApproveRate,
            current: current.falseApproveRate,
        });
    }
    const rates: [string, number, number][] = [
        ['decisionAccuracy', baseline.decisionAccuracy, current.decisionAccuracy],
        ...EVAL_DIMENSIONS.map((dimension): [string, number, number] => [
            dimension,
            baseline.dimensionPassRates[dimension],
            current.dimensionPassRates[dimension],
        ]),
    ];
    for (const [metric, before, now] of rates) {
        if (now < before - REGRESSION_TOLERANCE) regressions.push({ metric, baseline: before, current: now });
    }
    return regressions;
}
