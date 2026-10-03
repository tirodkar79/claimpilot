import type { ClaimFacts } from '../claims/claim-facts';
import type { FlightDataService } from '../flights/flight-data.service';
import type { FlightLookup } from '../flights/flight.types';
import { recordedLegs } from '../flights/recorded-flights';
import type { TraceRecorder } from '../trace/trace.service';
import { FlightAgent, MAX_FLIGHT_LOOKUPS, selectLeg } from './flight.agent';
import { mockLanguageModel, type MockStep } from './testing/mock-language-model';

const facts: ClaimFacts = {
    flightNumber: '6E2134',
    flightDate: '2026-09-22',
    origin: 'BOM',
    destination: 'DEL',
    claimedDelayMinutes: 240,
    claimedCause: 'fog',
};

const lookupOf = (flightNumber: string, date: string): FlightLookup => ({
    flightNumber,
    date,
    legs: recordedLegs(flightNumber, date),
    source: 'recorded',
});

/** Flight data stub backed by the recorded flights. */
function flightData() {
    return { lookup: jest.fn(async (number: string, date: string) => lookupOf(number, date)) };
}

/** Recorder keeping events in memory. */
function memoryRecorder() {
    const events: { type: string; message: string; data?: Record<string, unknown> }[] = [];
    const recorder: TraceRecorder = {
        record: async (_actor, type, message, extra) => {
            events.push({ type, message, data: extra?.data });
            return {} as never;
        },
    };
    return { recorder, events };
}

/**
 * Model that looks up the given dates in order, then answers with the given JSON.
 * @param dates Dates to look up.
 * @param answer Final JSON answer.
 */
function scripted(dates: string[], answer: Record<string, unknown>) {
    let step = 0;
    return mockLanguageModel((): MockStep => {
        const date = dates[step++];
        return date ? { toolCall: { name: 'getFlightStatus', input: { date } } } : { text: JSON.stringify(answer) };
    });
}

describe('selectLeg', () => {
    const reading = { date: '2026-09-22', origin: 'DEL', destination: 'SXR', notes: 'Second leg.' };

    it('accepts the agent’s pick when it was returned by a lookup and fits the claimed route', () => {
        const legFacts = { ...facts, flightNumber: '6E6187', origin: 'DEL', destination: 'SXR' };
        const findings = selectLeg(legFacts, reading, [lookupOf('6E6187', '2026-09-22')]);
        expect(findings).toMatchObject({ selectedBy: 'agent', leg: { origin: { iata: 'DEL' } } });
    });

    it('overrides a pick that contradicts the claimed route when exactly one leg fits', () => {
        const legFacts = { ...facts, flightNumber: '6E6187', origin: 'HYD', destination: 'DEL' };
        const findings = selectLeg(legFacts, reading, [lookupOf('6E6187', '2026-09-22')]);
        expect(findings).toMatchObject({ selectedBy: 'code', leg: { origin: { iata: 'HYD' } } });
    });

    it('refuses to guess when several legs fit and the pick is invalid', () => {
        const legFacts = { ...facts, flightNumber: '6E6187', origin: null, destination: null };
        const findings = selectLeg(legFacts, { ...reading, origin: 'BOM' }, [lookupOf('6E6187', '2026-09-22')]);
        expect(findings.leg).toBeUndefined();
    });

    it('reports not found when no lookup returned a leg', () => {
        expect(selectLeg(facts, { ...reading, origin: null }, [lookupOf('6E2314', '2026-09-22')]).leg).toBeUndefined();
    });
});

describe('FlightAgent', () => {
    it('looks the flight up through its tool and returns the matched leg', async () => {
        const data = flightData();
        const model = scripted(['2026-09-22'], {
            date: '2026-09-22',
            origin: 'BOM',
            destination: 'DEL',
            notes: 'Found.',
        });
        const { recorder, events } = memoryRecorder();

        const findings = await new FlightAgent(model, data as unknown as FlightDataService).investigate(
            facts,
            recorder,
        );

        expect(findings).toMatchObject({
            selectedBy: 'agent',
            source: 'recorded',
            lookups: [{ date: '2026-09-22', legs: 1 }],
        });
        expect(events.map((e) => e.message)).toEqual(['getFlightStatus(2026-09-22) → 1 leg(s)']);
    });

    it('refuses lookups beyond the cap', async () => {
        const data = flightData();
        const answer = { date: '2026-09-22', origin: 'BOM', destination: 'DEL', notes: 'x' };
        const model = scripted(['2026-09-22', '2026-09-23', '2026-09-21'], answer);
        const { recorder, events } = memoryRecorder();

        await new FlightAgent(model, data as unknown as FlightDataService)
            .investigate(facts, recorder)
            .catch(() => undefined);

        expect(data.lookup).toHaveBeenCalledTimes(MAX_FLIGHT_LOOKUPS);
        expect(events.filter((e) => e.data?.refused).map((e) => e.data?.date)).toEqual(['2026-09-21']);
    });

    it('refuses dates more than a day from the claimed date', async () => {
        const data = flightData();
        const answer = { date: '2026-09-30', origin: 'BOM', destination: 'DEL', notes: 'x' };
        const { recorder, events } = memoryRecorder();

        await new FlightAgent(scripted(['2026-09-30'], answer), data as unknown as FlightDataService).investigate(
            facts,
            recorder,
        );

        expect(events.find((e) => e.data?.refused)?.data?.date).toBe('2026-09-30');
        expect(data.lookup).not.toHaveBeenCalledWith('6E2134', '2026-09-30');
    });

    it('looks the flight up itself if the model never called the tool', async () => {
        const data = flightData();
        const model = scripted([], { date: '2026-09-22', origin: 'BOM', destination: 'DEL', notes: 'Guessing.' });
        const { recorder, events } = memoryRecorder();

        const findings = await new FlightAgent(model, data as unknown as FlightDataService).investigate(
            facts,
            recorder,
        );

        expect(events[0].type).toBe('guard.enforced');
        expect(findings).toMatchObject({ selectedBy: 'code', leg: { origin: { iata: 'BOM' } } });
    });
});
