import type { FlightFindings } from '../agents/flight.agent';
import type { WeatherFindings } from '../agents/weather.agent';
import { recordedLegs } from '../flights/recorded-flights';
import { POLICY_SEEDS } from '../policies/policies.seed';
import { checkGrounding } from '../safety/summary-grounding';
import type { ClaimFacts } from './claim-facts';
import { evidenceSummary, groundingAllowList, type SummaryEvidence } from './claim-summary';

const facts = {
    flightNumber: '6E2134',
    flightDate: '2026-09-22',
    origin: 'BOM',
    destination: 'DEL',
    claimedDelayMinutes: 240,
    claimedCause: 'fog',
} as ClaimFacts;
const policy = POLICY_SEEDS.find((p) => p.policyId === 'P-77')!;
const flight = { leg: recordedLegs('6E2134', '2026-09-22')[0] } as FlightFindings;
const weather = {
    severe: true,
    checks: [
        { airport: 'BOM', role: 'departure', severe: false, severeObservations: [] },
        { airport: 'DEL', role: 'arrival', severe: true, severeObservations: [] },
    ],
} as unknown as WeatherFindings;
const evidence = { facts, policy, flight, weather } as SummaryEvidence;

describe('evidenceSummary', () => {
    it('states the policy, flight times and weather from the evidence only', () => {
        const summary = evidenceSummary(evidence);
        expect(summary).toContain('Policy P-77');
        expect(summary).toContain('Flight 6E2134 BOM → DEL: scheduled departure');
        expect(summary).toContain('(230 minutes late)');
        expect(summary).toContain('Severe weather recorded at DEL.');
    });

    it('passes its own grounding check', () => {
        expect(checkGrounding(evidenceSummary(evidence), groundingAllowList(evidence)).grounded).toBe(true);
    });

    it('says when the flight has no record', () => {
        expect(evidenceSummary({ facts, policy: null, flight: {} as FlightFindings })).toBe(
            'No record found for flight 6E2134 on 2026-09-22.',
        );
    });
});

describe('groundingAllowList', () => {
    it('allows local times, never UTC ones', () => {
        const { times } = groundingAllowList(evidence);
        const utc = flight.leg!.scheduledDeparture.slice(11, 16);
        expect(times.size).toBeGreaterThan(0);
        expect(times.has(utc)).toBe(false);
    });
});
