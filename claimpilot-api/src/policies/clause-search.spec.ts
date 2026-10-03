import { searchClauses } from './clause-search';
import { POLICY_SEEDS } from './policies.seed';

const standard = POLICY_SEEDS.find((policy) => policy.policyId === 'P-77')!.clauses;

describe('searchClauses', () => {
    it('finds the weather exclusion', () => {
        expect(searchClauses(standard, 'weather exclusion fog')[0].id).toBe('7.3');
    });

    it('ranks title matches above text matches', () => {
        expect(searchClauses(standard, 'how delay is measured')[0].id).toBe('4.1');
    });

    it('handles plurals and case', () => {
        expect(searchClauses(standard, 'STRIKES')[0].id).toBe('7.4');
    });

    it('limits the number of results', () => {
        expect(searchClauses(standard, 'delay', 2)).toHaveLength(2);
    });

    it('returns nothing for empty or stop-word-only queries', () => {
        expect(searchClauses(standard, '')).toEqual([]);
        expect(searchClauses(standard, 'what is the')).toEqual([]);
        expect(searchClauses(standard, 'volcano')).toEqual([]);
    });
});
