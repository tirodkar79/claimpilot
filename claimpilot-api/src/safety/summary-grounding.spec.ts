import { checkGrounding, type GroundingAllowList } from './summary-grounding';

const allowed: GroundingAllowList = {
    clauses: new Set(['4.1', '7.3']),
    flightNumbers: new Set(['6E2134']),
    times: new Set(['10:35', '14:25']),
    dates: new Set(['2026-09-22']),
    amounts: new Set([2000]),
    minutes: new Set([230]),
};

describe('checkGrounding', () => {
    it('accepts a summary whose every value is in the evidence', () => {
        const text =
            'Flight 6E-2134 on 2026-09-22 left at 14:25 instead of 10:35, 230 minutes late; §4.1 pays ₹2,000. Clause 7.3 does not apply.';
        expect(checkGrounding(text, allowed)).toEqual({ grounded: true, unsupported: [] });
    });

    it('accepts a summary with no specific values', () => {
        expect(checkGrounding('Checked the policy and the flight record.', allowed).grounded).toBe(true);
    });

    it('flags a UTC time quoted as local, an invented clause and a wrong amount', () => {
        expect(checkGrounding('Departed 5:05 (§9.9); pays INR 5000 for a 230-minute delay.', allowed)).toEqual({
            grounded: false,
            unsupported: ['clause 9.9', 'time 05:05', 'amount 5000'],
        });
    });

    it('flags another flight, date or delay', () => {
        expect(checkGrounding('AI 865 on 2026-09-21 was 80 mins late.', allowed).unsupported).toEqual([
            'flight AI865',
            'date 2026-09-21',
            'minutes 80',
        ]);
    });
});
