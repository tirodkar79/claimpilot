import type { FlightFindings } from '../agents/flight.agent';
import type { PolicyFindings } from '../agents/policy.agent';
import type { WeatherFindings } from '../agents/weather.agent';
import { recordedLegs } from '../flights/recorded-flights';
import { POLICY_SEEDS } from '../policies/policies.seed';
import type { Policy } from '../policies/policy.schema';
import { adjudicate, AdjudicationInput } from './adjudicate';
import type { ClaimFacts } from './claim-facts';

const standard = POLICY_SEEDS.find((p) => p.policyId === 'P-77') as Policy; // departure; 2h ₹2,000, 4h ₹5,000, 6h ₹10,000
const plus = POLICY_SEEDS.find((p) => p.policyId === 'P-91') as Policy; // arrival; 90m ₹3,000, 3h ₹6,000

const facts: ClaimFacts = {
    flightNumber: '6E2134',
    flightDate: '2026-09-22',
    origin: 'BOM',
    destination: 'DEL',
    claimedDelayMinutes: 240,
    claimedCause: 'technical fault',
};

const noExclusions: PolicyFindings = {
    policyId: 'P-77',
    delayMeasure: 'departure',
    delayMeasureMismatch: false,
    relevantExclusions: [],
    summary: '',
    citedClauses: [],
    droppedCitations: [],
};

/**
 * Flight findings built from the recorded flights.
 * @param flightNumber Recorded flight number.
 */
function flight(flightNumber: string): FlightFindings {
    const [leg] = recordedLegs(flightNumber, '2026-09-22');
    return { flightNumber, claimedDate: '2026-09-22', leg, source: 'recorded', notes: '', lookups: [] };
}

const input: AdjudicationInput = {
    facts,
    policy: standard,
    policyId: 'P-77',
    customerId: 'C-1042',
    submittedOn: '2026-09-25',
    policyFindings: noExclusions,
    flight: flight('6E2134'),
};

describe('adjudicate: policy checks', () => {
    it('asks for the policy number when the policy does not exist', () => {
        expect(adjudicate({ ...input, policy: null, policyId: 'P-7' })).toMatchObject({ decision: 'NEED_INFO' });
    });

    it('refers a policy held by someone else', () => {
        expect(adjudicate({ ...input, customerId: 'C-9999' }).decision).toBe('REFER');
    });

    it.each([
        ['the day before cover starts', '2026-05-31'],
        ['the day after cover ends', '2027-06-01'],
    ])('rejects a flight %s, citing the cover period', (_label, flightDate) => {
        const outcome = adjudicate({ ...input, facts: { ...facts, flightDate }, submittedOn: flightDate });
        expect(outcome).toMatchObject({ decision: 'REJECT', citations: [{ clauseId: '2.1' }] });
    });

    it('accepts a claim on the last day of the deadline and rejects it the day after', () => {
        expect(adjudicate({ ...input, submittedOn: '2026-10-22' }).decision).toBe('APPROVE');
        expect(adjudicate({ ...input, submittedOn: '2026-10-23' })).toMatchObject({
            decision: 'REJECT',
            citations: [{ clauseId: '9.2' }],
        });
    });
});

describe('adjudicate: flight evidence', () => {
    it('pays the tier the record reaches, not the one claimed', () => {
        const outcome = adjudicate(input); // claimed 4h, record 3h50m
        expect(outcome).toMatchObject({
            decision: 'APPROVE',
            payout: { amount: 2000, currency: 'INR', minDelayMinutes: 120 },
            evidencedDelayMinutes: 230,
            citations: [{ clauseId: '4.1' }, { clauseId: '4.2' }],
        });
        expect(outcome.reasons).toEqual([
            'The flight record shows a departure delay of 3h 50m, which meets the 2h 00m tier.',
            'The claimant reported 4h 00m; the payout follows the flight record.',
        ]);
    });

    it('pays the top tier', () => {
        expect(adjudicate({ ...input, flight: flight('UK951') }).payout?.amount).toBe(10000);
    });

    it('rejects a delay below every tier, with the measure and tier clauses', () => {
        const outcome = adjudicate({ ...input, flight: flight('AI865') });
        expect(outcome).toMatchObject({ decision: 'REJECT', evidencedDelayMinutes: 80 });
        expect(outcome.reasons[0]).toBe(
            'The flight record shows a departure delay of 1h 20m, below the 2h 00m needed for a payout.',
        );
    });

    it('measures delay the way the policy says: the same flight pays differently under each policy', () => {
        const qp = flight('QP1303'); // 100m late leaving, 190m late arriving
        expect(adjudicate({ ...input, flight: qp }).decision).toBe('REJECT'); // departure 100m < 2h
        const underPlus = adjudicate({ ...input, policy: plus, policyId: 'P-91', customerId: 'C-2077', flight: qp });
        expect(underPlus).toMatchObject({ decision: 'APPROVE', payout: { amount: 6000 }, evidencedDelayMinutes: 190 });
    });

    it('asks the claimant to confirm the flight when no record matches', () => {
        const outcome = adjudicate({ ...input, flight: { ...flight('6E2134'), leg: undefined } });
        expect(outcome.decision).toBe('NEED_INFO');
        expect(outcome.reasons[0]).toContain("couldn't find flight 6E2134 on 2026-09-22 from BOM to DEL");
    });

    it('refers cancellations and flights with no actual time', () => {
        expect(adjudicate({ ...input, flight: flight('SG160') }).decision).toBe('REFER');
        const inFlight = flight('6E2134');
        inFlight.leg = { ...inFlight.leg!, actualDeparture: undefined };
        expect(adjudicate({ ...input, flight: inFlight }).decision).toBe('REFER');
    });

    const weatherExcluded: PolicyFindings = {
        ...noExclusions,
        relevantExclusions: [{ type: 'severe_weather', clauseId: '7.3', summary: 'Fog excluded.' }],
    };

    /**
     * Weather findings for 6E2134 with optional fog at DEL.
     * @param fog Whether fog was observed.
     */
    function weatherFindings(fog: boolean): WeatherFindings {
        return {
            source: 'open-meteo-mcp',
            severe: fog,
            notes: '',
            guardFetched: [],
            checks: [
                {
                    airport: 'BOM',
                    role: 'departure',
                    windowStart: '',
                    windowEnd: '',
                    severe: false,
                    severeObservations: [],
                    observationCount: 7,
                },
                {
                    airport: 'DEL',
                    role: 'arrival',
                    windowStart: '',
                    windowEnd: '',
                    severe: fog,
                    observationCount: 6,
                    severeObservations: fog
                        ? [
                              {
                                  time: '2026-09-22T16:00:00.000Z',
                                  weatherCode: 45,
                                  condition: 'fog',
                                  gustKmh: 8,
                                  precipitationMm: 0,
                                  severe: true,
                              },
                          ]
                        : [],
                },
            ],
        };
    }

    it('rejects under the weather exclusion when the records show severe weather, citing the observation', () => {
        const outcome = adjudicate({ ...input, policyFindings: weatherExcluded, weather: weatherFindings(true) });
        expect(outcome).toMatchObject({
            decision: 'REJECT',
            citations: [{ clauseId: '7.3' }],
            evidencedDelayMinutes: 230,
        });
        expect(outcome.reasons).toEqual([
            'Weather records show fog at DEL at 2026-09-22 21:30 Asia/Kolkata, so exclusion §7.3 applies.',
            'Without the exclusion the departure delay of 3h 50m would have qualified for INR 2,000.',
        ]);
    });

    it('approves when the records show no severe weather, saying why the exclusion does not apply', () => {
        const outcome = adjudicate({ ...input, policyFindings: weatherExcluded, weather: weatherFindings(false) });
        expect(outcome).toMatchObject({ decision: 'APPROVE', payout: { amount: 2000 } });
        expect(outcome.reasons).toContain(
            "Weather records show no severe weather at BOM and DEL around the flight, so exclusion §7.3 doesn't apply.",
        );
    });

    it('refers when a weather exclusion could apply but no weather records were available', () => {
        const outcome = adjudicate({ ...input, policyFindings: weatherExcluded });
        expect(outcome).toMatchObject({ decision: 'REFER', citations: [{ clauseId: '7.3' }] });
        expect(outcome.reasons[0]).toContain('no weather records were available');
    });

    it('refers a strike exclusion, which no agent can check yet', () => {
        const strike: PolicyFindings = {
            ...noExclusions,
            relevantExclusions: [{ type: 'industrial_action', clauseId: '7.4', summary: 'Strikes excluded.' }],
        };
        const outcome = adjudicate({ ...input, policyFindings: strike });
        expect(outcome).toMatchObject({ decision: 'REFER', citations: [{ clauseId: '7.4' }] });
        expect(outcome.reasons[0]).toContain('qualifies for INR 2,000');
    });

    it('does not hold a payout for exclusions that are integrity checks, not evidence checks', () => {
        const knownBefore: PolicyFindings = {
            ...noExclusions,
            relevantExclusions: [{ type: 'known_before_purchase', clauseId: '7.1', summary: '' }],
        };
        expect(adjudicate({ ...input, policyFindings: knownBefore }).decision).toBe('APPROVE');
    });

    describe('integrity', () => {
        it('rejects a claim for a flight already paid out', () => {
            const outcome = adjudicate({
                ...input,
                integrity: {
                    flags: [{ code: 'duplicate_paid', detail: 'Claim abc123 for this flight was already approved.' }],
                    checked: { duplicates: 1, booking: 'matched', purchase: 'before_departure' },
                },
            });
            expect(outcome.decision).toBe('REJECT');
            expect(outcome.reasons[0]).toContain('already been paid');
        });

        it('refers other flags instead of rejecting, listing each one and citing the clause', () => {
            const outcome = adjudicate({
                ...input,
                integrity: {
                    flags: [
                        {
                            code: 'late_purchase',
                            detail: 'Policy P-77 was bought after the flight was due to depart.',
                            clauseId: '7.1',
                        },
                        { code: 'not_on_booking', detail: 'Customer C-1042 is not a passenger on ZZ9999.' },
                    ],
                    checked: { duplicates: 0, booking: 'problem', purchase: 'after_departure' },
                },
            });
            expect(outcome).toMatchObject({
                decision: 'REFER',
                citations: [{ clauseId: '7.1' }],
                evidencedDelayMinutes: 230,
            });
            expect(outcome.reasons).toHaveLength(3);
        });

        it('does not let a flag turn a rejection into a referral', () => {
            const outcome = adjudicate({
                ...input,
                flight: flight('AI865'),
                integrity: {
                    flags: [{ code: 'not_on_booking', detail: 'x' }],
                    checked: { duplicates: 0, booking: 'problem', purchase: 'before_departure' },
                },
            });
            expect(outcome.decision).toBe('REJECT');
        });
    });
});
