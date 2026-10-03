import { POLICY_SEEDS } from '../policies/policies.seed';
import type { Policy } from '../policies/policy.schema';
import { adjudicate, AdjudicationInput } from './adjudicate';
import type { ClaimFacts } from './claim-facts';

const policy = POLICY_SEEDS.find((p) => p.policyId === 'P-77') as Policy; // cover 2026-06-01..2027-05-31, 30 days

const facts: ClaimFacts = {
    flightNumber: '6E2134',
    flightDate: '2026-09-12',
    origin: 'BOM',
    destination: 'DEL',
    claimedDelayMinutes: 240,
    claimedCause: 'fog',
};

const input: AdjudicationInput = {
    facts,
    policy,
    policyId: 'P-77',
    customerId: 'C-1042',
    submittedOn: '2026-09-20',
};

describe('adjudicate', () => {
    it('is PENDING when the policy covers the flight, citing cover period and deadline', () => {
        const outcome = adjudicate(input);
        expect(outcome.decision).toBe('PENDING');
        expect(outcome.citations.map((c) => c.clauseId)).toEqual(['2.1', '9.2']);
    });

    it('asks for the policy number when the policy does not exist', () => {
        expect(adjudicate({ ...input, policy: null, policyId: 'P-7' })).toEqual({
            decision: 'NEED_INFO',
            reasons: ["We couldn't find policy P-7. Please check the policy number."],
            citations: [],
        });
    });

    it('refers a policy held by someone else instead of rejecting it', () => {
        expect(adjudicate({ ...input, customerId: 'C-9999' }).decision).toBe('REFER');
    });

    it.each([
        ['the day before cover starts', '2026-05-31'],
        ['the day after cover ends', '2027-06-01'],
    ])('rejects a flight %s, citing the cover period', (_label, flightDate) => {
        const outcome = adjudicate({ ...input, facts: { ...facts, flightDate }, submittedOn: flightDate });
        expect(outcome.decision).toBe('REJECT');
        expect(outcome.citations).toEqual([{ clauseId: '2.1', title: 'Period of cover' }]);
    });

    it('covers flights on the first and last day of cover', () => {
        for (const flightDate of ['2026-06-01', '2027-05-31']) {
            expect(adjudicate({ ...input, facts: { ...facts, flightDate }, submittedOn: flightDate }).decision).toBe(
                'PENDING',
            );
        }
    });

    it('accepts a claim on the last day of the deadline and rejects it the day after', () => {
        expect(adjudicate({ ...input, submittedOn: '2026-10-12' }).decision).toBe('PENDING');

        const late = adjudicate({ ...input, submittedOn: '2026-10-13' });
        expect(late.decision).toBe('REJECT');
        expect(late.reasons[0]).toContain('31 days');
        expect(late.citations).toEqual([{ clauseId: '9.2', title: 'Making a claim' }]);
    });

    it('rejects a flight under an expired policy', () => {
        const expired = POLICY_SEEDS.find((p) => p.policyId === 'P-12') as Policy;
        expect(adjudicate({ ...input, policy: expired, policyId: 'P-12' }).decision).toBe('REJECT');
    });
});
