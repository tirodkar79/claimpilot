import type { IntakeExtraction } from '../agents/intake.agent';
import { findMissingInformation, normaliseFacts } from './claim-facts';

const extraction: IntakeExtraction = {
    flightNumber: '6e-2134',
    flightDate: '2026-09-12',
    origin: 'bom',
    destination: 'DEL',
    claimedDelayMinutes: 240,
    claimedCause: ' fog ',
};

describe('normaliseFacts', () => {
    it('normalises codes and trims text', () => {
        expect(normaliseFacts(extraction)).toEqual({
            flightNumber: '6E2134',
            flightDate: '2026-09-12',
            origin: 'BOM',
            destination: 'DEL',
            claimedDelayMinutes: 240,
            claimedCause: 'fog',
        });
    });

    it.each([
        ['a malformed flight number', { flightNumber: 'flight to delhi' }, 'flightNumber'],
        ['an impossible date', { flightDate: '2026-02-30' }, 'flightDate'],
        ['a non-ISO date', { flightDate: '12 Dec' }, 'flightDate'],
        ['a city name instead of a code', { origin: 'Mumbai' }, 'origin'],
        ['a zero delay', { claimedDelayMinutes: 0 }, 'claimedDelayMinutes'],
        ['an implausible delay', { claimedDelayMinutes: 10_000 }, 'claimedDelayMinutes'],
        ['a blank cause', { claimedCause: '   ' }, 'claimedCause'],
    ] as const)('drops %s', (_label, override, field) => {
        expect(normaliseFacts({ ...extraction, ...override })[field]).toBeNull();
    });

    it('rounds fractional delays', () => {
        expect(normaliseFacts({ ...extraction, claimedDelayMinutes: 90.4 }).claimedDelayMinutes).toBe(90);
    });
});

describe('findMissingInformation', () => {
    const complete = normaliseFacts(extraction);

    it('returns nothing for a complete claim', () => {
        expect(findMissingInformation(complete, '2026-10-01')).toEqual([]);
    });

    it('does not require route or cause', () => {
        const facts = { ...complete, origin: null, destination: null, claimedCause: null };
        expect(findMissingInformation(facts, '2026-10-01')).toEqual([]);
    });

    it('asks for each missing required fact', () => {
        const facts = { ...complete, flightNumber: null, flightDate: null, claimedDelayMinutes: null };
        expect(findMissingInformation(facts, '2026-10-01').map((item) => item.field)).toEqual([
            'flightNumber',
            'flightDate',
            'claimedDelayMinutes',
        ]);
    });

    it('questions a flight date in the future', () => {
        const [issue] = findMissingInformation({ ...complete, flightDate: '2026-12-12' }, '2026-10-01');
        expect(issue).toEqual({ field: 'flightDate', question: expect.stringContaining('in the future') });
    });
});
