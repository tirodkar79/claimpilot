import type { EvalAttempt, EvalCaseResult } from './evals.constants';
import { findRegressions, summariseRun } from './eval-metrics';

const pass = (decision: EvalAttempt['decision'], extra: Partial<EvalAttempt> = {}): EvalAttempt => ({
    decision,
    checks: [
        { dimension: 'decision', name: 'decision', pass: true },
        { dimension: 'routing', name: 'guard interventions', pass: true },
    ],
    guardInterventions: 0,
    toolCalls: 2,
    durationMs: 1000,
    ...extra,
});
const fail = (decision: EvalAttempt['decision']): EvalAttempt => ({
    ...pass(decision),
    checks: [
        { dimension: 'decision', name: 'decision', pass: false },
        { dimension: 'routing', name: 'guard interventions', pass: false },
    ],
    guardInterventions: 1,
});

/**
 * Builds one case result.
 * @param id Case id.
 * @param expectedDecision Expected decision.
 * @param attempts Attempts.
 * @param source Scenario or review.
 */
function result(
    id: string,
    expectedDecision: EvalCaseResult['expectedDecision'],
    attempts: EvalAttempt[],
    source: EvalCaseResult['source'] = 'scenario',
): EvalCaseResult {
    return { id, title: id, tests: '', source, expectedDecision, attempts };
}

describe('summariseRun', () => {
    const results = [
        result('approve', 'APPROVE', [pass('APPROVE'), pass('APPROVE')]),
        result('reject', 'REJECT', [pass('REJECT'), fail('APPROVE')]),
        result('refer', 'REFER', [pass('REFER'), pass(undefined, { error: 'Model provider error: quota' })]),
        result('reviewed', 'APPROVE', [pass('REFER')], 'review'),
    ];
    const metrics = summariseRun(results);

    it('scores scenario attempts and sets provider errors aside', () => {
        expect(metrics).toMatchObject({ cases: 3, attempts: 5, erroredAttempts: 1, guardInterventions: 1 });
        expect(metrics.decisionAccuracy).toBeCloseTo(4 / 5);
        expect(metrics.dimensionPassRates.routing).toBeCloseTo(4 / 5);
    });

    it('counts approvals that should not have happened', () => {
        expect(metrics.falseApproveRate).toBeCloseTo(1 / 3);
        expect(metrics.confusion.REJECT).toMatchObject({ REJECT: 1, APPROVE: 1 });
    });

    it('separates consistent and flaky cases', () => {
        expect(metrics).toMatchObject({ consistentCases: 2, flakyCases: 1 });
    });

    it('reports reviewer agreement from review cases only', () => {
        expect(metrics.reviewerAgreement).toBe(0);
        expect(summariseRun(results.slice(0, 1)).reviewerAgreement).toBeNull();
    });

    it('averages judge scores when the judge ran', () => {
        const judged = summariseRun([
            result('a', 'APPROVE', [
                pass('APPROVE', { judge: { clarity: 4, faithfulness: 5, tone: 5, comment: '' } }),
                pass('APPROVE', { judge: { clarity: 5, faithfulness: 4, tone: 5, comment: '' } }),
            ]),
        ]);
        expect(judged.judge).toEqual({ clarity: 4.5, faithfulness: 4.5, tone: 5 });
        expect(metrics.judge).toBeNull();
    });
});

describe('findRegressions', () => {
    const baseline = summariseRun([
        result('approve', 'APPROVE', [pass('APPROVE')]),
        result('r', 'REJECT', [pass('REJECT')]),
    ]);

    it('finds nothing when a run matches the baseline', () => {
        expect(findRegressions(baseline, baseline)).toEqual([]);
    });

    it('names every metric that dropped beyond tolerance, and any new false approval', () => {
        const worse = summariseRun([
            result('approve', 'APPROVE', [pass('APPROVE')]),
            result('r', 'REJECT', [fail('APPROVE')]),
        ]);
        expect(findRegressions(worse, baseline).map((regression) => regression.metric)).toEqual([
            'falseApproveRate',
            'decisionAccuracy',
            'decision',
            'routing',
        ]);
    });
});
