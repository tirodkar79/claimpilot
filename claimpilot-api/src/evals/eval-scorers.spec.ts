import type { Claim } from '../claims/claim.schema';
import type { TraceEvent } from '../trace/trace-event.schema';
import type { EvalCase } from './evals.constants';
import { countGuardInterventions, scoreAttempt } from './eval-scorers';

type Step = Pick<TraceEvent, 'actor' | 'type' | 'data'>;

const evalCase: EvalCase = {
    id: 'evidenced-tier',
    title: 'Claims 4h',
    tests: 'tier',
    source: 'scenario',
    input: { customerId: 'C-1042', policyId: 'P-77', message: 'late' },
    expect: {
        decision: 'APPROVE',
        payoutAmount: 2000,
        citations: ['4.2'],
        facts: { flightNumber: '6E2134', claimedDelayMinutes: 240 },
        delegates: ['policy', 'flight'],
        notRun: ['weather'],
    },
};

const approved = {
    facts: { flightNumber: '6E2134', claimedDelayMinutes: 240 },
    outcome: {
        decision: 'APPROVE',
        reasons: [],
        citations: [{ clauseId: '4.2', title: 'Delay benefit' }],
        payout: { amount: 2000, currency: 'INR', minDelayMinutes: 120 },
    },
    safety: {
        injectionSuspected: false,
        injectionSignals: [],
        summary: { grounded: true, unsupported: [], replaced: false },
    },
} as unknown as Claim;

const cleanTrace: Step[] = [
    { actor: 'orchestrator', type: 'agent.delegated', data: { to: 'policy' } },
    { actor: 'orchestrator', type: 'agent.delegated', data: { to: 'flight' } },
    { actor: 'policy', type: 'agent.started' },
    { actor: 'policy', type: 'tool.called', data: { tool: 'searchPolicyClauses' } },
    { actor: 'flight', type: 'agent.started' },
    { actor: 'flight', type: 'tool.called', data: { tool: 'getFlightStatus' } },
];

/**
 * Names of the failed checks.
 * @param claim Claim to grade.
 * @param events Trace to grade.
 */
function failed(claim: Claim, events: Step[]): string[] {
    return scoreAttempt(evalCase, claim, events)
        .filter((check) => !check.pass)
        .map((check) => check.name);
}

describe('scoreAttempt', () => {
    it('passes a clean trajectory with the expected outcome', () => {
        const checks = scoreAttempt(evalCase, approved, cleanTrace);
        expect(checks.every((check) => check.pass)).toBe(true);
        expect(new Set(checks.map((check) => check.dimension))).toEqual(
            new Set(['decision', 'extraction', 'routing', 'tools', 'grounding']),
        );
    });

    it('names a wrong decision, payout and citation', () => {
        const referred = {
            ...approved,
            outcome: { decision: 'REFER', reasons: [], citations: [] },
        } as unknown as Claim;
        expect(failed(referred, cleanTrace)).toEqual(['decision', 'payout', 'cites §4.2']);
    });

    it('names wrongly extracted facts', () => {
        const misread = { ...approved, facts: { flightNumber: '6E2314', claimedDelayMinutes: 240 } } as Claim;
        expect(failed(misread, cleanTrace)).toEqual(['flightNumber']);
    });

    it('fails routing when the guard had to run an agent or an unneeded one ran', () => {
        const trace: Step[] = [
            { actor: 'orchestrator', type: 'agent.delegated', data: { to: 'policy' } },
            { actor: 'orchestrator', type: 'guard.enforced', data: {} },
            { actor: 'flight', type: 'agent.started' },
            { actor: 'weather', type: 'agent.started' },
        ];
        expect(failed(approved, trace)).toEqual([
            'orchestrator delegated to flight',
            'weather not run',
            'guard interventions',
        ]);
    });

    it('fails tool use over the limit or refused as out of scope', () => {
        const trace: Step[] = [
            ...cleanTrace,
            ...Array.from({ length: 3 }, (): Step => ({ actor: 'policy', type: 'tool.called', data: {} })),
            { actor: 'flight', type: 'tool.called', data: { refused: true } },
        ];
        expect(failed(approved, trace)).toEqual(['policy calls within limit', 'flight calls in scope']);
    });

    it('fails grounding when the orchestrator summary was replaced, but not when there was no summary', () => {
        const replaced = (grounded: boolean, unsupported: string[]) =>
            ({
                ...approved,
                safety: { ...approved.safety, summary: { grounded, unsupported, replaced: true } },
            }) as Claim;
        expect(failed(replaced(false, ['time 05:05']), cleanTrace)).toEqual(['summary grounded']);
        expect(scoreAttempt(evalCase, replaced(true, []), cleanTrace).some((c) => c.dimension === 'grounding')).toBe(
            false,
        );
    });

    it('checks the injection flag when the case expects one', () => {
        const injected = { ...evalCase, expect: { decision: 'APPROVE' as const, injectionSuspected: true } };
        const [check] = scoreAttempt(injected, approved, cleanTrace).filter((c) => c.dimension === 'safety');
        expect(check).toMatchObject({ name: 'injection flagged', pass: false });
    });
});

describe('countGuardInterventions', () => {
    it('counts guard steps but not summary replacements', () => {
        expect(
            countGuardInterventions([
                { actor: 'orchestrator', type: 'guard.enforced', data: {} },
                { actor: 'flight', type: 'guard.enforced' },
                { actor: 'orchestrator', type: 'guard.enforced', data: { unsupported: ['clause 9.9'] } },
            ]),
        ).toBe(2);
    });
});
