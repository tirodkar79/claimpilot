import { Agent } from '@mastra/core/agent';
import type { MastraModelConfig } from '@mastra/core/llm';
import { createTool } from '@mastra/core/tools';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { ClaimFacts } from '../claims/claim-facts';
import { FlightDataService } from '../flights/flight-data.service';
import type { FlightDataSource, FlightLeg, FlightLookup } from '../flights/flight.types';
import { localDateTime } from '../common/utils/local-date';
import type { TraceRecorder } from '../trace/trace.service';
import { LANGUAGE_MODEL } from './language-model.provider';

/** Lookups per claim: the claimed date, plus one adjacent day for overnight or time-zone mix-ups. */
export const MAX_FLIGHT_LOOKUPS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

const flightReadingSchema = z.object({
    date: z.string().describe('Departure date (YYYY-MM-DD) of the matching leg, as looked up'),
    origin: z.string().nullable().describe('IATA code where the matching leg departs; null if nothing matches'),
    destination: z.string().nullable().describe('IATA code where the matching leg arrives; null if nothing matches'),
    notes: z.string().describe('One or two sentences for a reviewer: what was found'),
});

type FlightReading = z.infer<typeof flightReadingSchema>;

/** Flight evidence after code has checked the agent's choice against the actual lookups. */
export interface FlightFindings {
    flightNumber: string;
    claimedDate: string;
    /** The leg the claim is about; undefined when no leg could be matched. */
    leg?: FlightLeg;
    source?: FlightDataSource;
    /** Who picked the leg: the agent, or code (agent's pick invalid, or the agent didn't look). */
    selectedBy?: 'agent' | 'code';
    notes: string;
    lookups: { date: string; legs: number }[];
}

const INSTRUCTIONS = `You find what actually happened to a flight for a delay claim.

Use getFlightStatus with the claimed date. If the flight isn't found on that date, you may try the day
before or after once (overnight flights and time-zone mix-ups). You may look up at most ${MAX_FLIGHT_LOOKUPS} dates.
If several legs fly under the number, pick the one matching the claimed route.

Answer with the date, origin and destination of the matching leg exactly as returned by the tool,
or null origin/destination if nothing matches. Don't calculate delays; code does that.`;

/**
 * Finds the flight leg a claim is about. Its tool is bound to the claimed flight number and to dates within
 * a day of the claimed date. Delay is never taken from the model: code computes it from the leg's times.
 */
@Injectable()
export class FlightAgent {
    constructor(
        @Inject(LANGUAGE_MODEL) private readonly model: MastraModelConfig,
        private readonly flights: FlightDataService,
    ) {}

    /**
     * Looks up the claimed flight and selects the matching leg.
     * @param facts Claim facts; `flightNumber` and `flightDate` must be present.
     * @param recorder Trace recorder of the current run.
     * @throws When the model fails, or the flight data source fails (UpstreamError).
     */
    async investigate(facts: ClaimFacts, recorder: TraceRecorder): Promise<FlightFindings> {
        const flightNumber = facts.flightNumber as string;
        const claimedDate = facts.flightDate as string;
        const lookups: FlightLookup[] = [];

        const agent = new Agent({
            id: 'flight',
            name: 'Flight evidence',
            instructions: INSTRUCTIONS,
            model: this.model,
            tools: { getFlightStatus: this.lookupTool(flightNumber, claimedDate, lookups, recorder) },
        });
        const prompt =
            `Flight ${flightNumber}, claimed date ${claimedDate}, claimed route ` +
            `${facts.origin ?? '?'} → ${facts.destination ?? '?'}.`;
        const result = await agent.generate(prompt, {
            maxSteps: MAX_FLIGHT_LOOKUPS + 1,
            structuredOutput: { schema: flightReadingSchema, jsonPromptInjection: true },
        });
        const reading = flightReadingSchema.parse(result.object);

        if (!lookups.length) {
            // The agent never saw any data, so its answer is a guess: code looks up and picks the leg.
            await recorder.record('flight', 'guard.enforced', 'Agent did not look the flight up; looking it up');
            lookups.push(await this.flights.lookup(flightNumber, claimedDate));
            return selectLeg(facts, { ...reading, origin: null, destination: null }, lookups);
        }
        return selectLeg(facts, reading, lookups);
    }

    /**
     * Flight lookup bound to one flight number and a ±1-day window. Calls past the cap are refused.
     * @param flightNumber Claimed flight number.
     * @param claimedDate Claimed departure date.
     * @param lookups Lookups of this run (mutated).
     * @param recorder Trace recorder.
     */
    private lookupTool(flightNumber: string, claimedDate: string, lookups: FlightLookup[], recorder: TraceRecorder) {
        return createTool({
            id: 'getFlightStatus',
            description: `Scheduled and actual times of flight ${flightNumber} on a departure date.`,
            inputSchema: z.object({ date: z.string().describe('Local departure date, YYYY-MM-DD') }),
            execute: async ({ date }) => {
                const withinWindow = Math.abs(Date.parse(date) - Date.parse(claimedDate)) <= DAY_MS;
                if (!withinWindow || lookups.length >= MAX_FLIGHT_LOOKUPS) {
                    await recorder.record('flight', 'tool.called', `getFlightStatus(${date}) refused`, {
                        data: { tool: 'getFlightStatus', date, refused: true },
                    });
                    return { error: `Only ${MAX_FLIGHT_LOOKUPS} lookups within a day of ${claimedDate} are allowed.` };
                }
                const lookup = await this.flights.lookup(flightNumber, date);
                lookups.push(lookup);
                await recorder.record(
                    'flight',
                    'tool.called',
                    `getFlightStatus(${date}) → ${lookup.legs.length} leg(s)`,
                    {
                        data: { tool: 'getFlightStatus', date, legs: lookup.legs.length, source: lookup.source },
                    },
                );
                return {
                    date,
                    // Local times with the zone, so the model never reads UTC as local time.
                    legs: lookup.legs.map((leg) => ({
                        origin: leg.origin.iata,
                        destination: leg.destination.iata,
                        status: leg.status,
                        scheduledDeparture: localDateTime(leg.scheduledDeparture, leg.origin.timeZone),
                        actualDeparture: leg.actualDeparture
                            ? localDateTime(leg.actualDeparture, leg.origin.timeZone)
                            : null,
                        scheduledArrival: localDateTime(leg.scheduledArrival, leg.destination.timeZone),
                        actualArrival: leg.actualArrival
                            ? localDateTime(leg.actualArrival, leg.destination.timeZone)
                            : null,
                    })),
                };
            },
        });
    }
}

/**
 * Picks the leg the claim is about. The agent's choice is used only if that leg really was returned by a
 * lookup and fits the claimed route; otherwise code picks the only leg that fits, if there is exactly one.
 * @param facts Claim facts.
 * @param reading Agent's answer.
 * @param lookups Lookups made during the run.
 */
export function selectLeg(facts: ClaimFacts, reading: FlightReading, lookups: FlightLookup[]): FlightFindings {
    const base = {
        flightNumber: facts.flightNumber as string,
        claimedDate: facts.flightDate as string,
        notes: reading.notes,
        lookups: lookups.map((lookup) => ({ date: lookup.date, legs: lookup.legs.length })),
    };
    const fitsClaim = (leg: FlightLeg) =>
        (!facts.origin || leg.origin.iata === facts.origin) &&
        (!facts.destination || leg.destination.iata === facts.destination);
    const candidates = lookups.flatMap((lookup) =>
        lookup.legs.filter(fitsClaim).map((leg) => ({ leg, date: lookup.date, source: lookup.source })),
    );

    const agentPick = candidates.find(
        ({ leg, date }) =>
            date === reading.date && leg.origin.iata === reading.origin && leg.destination.iata === reading.destination,
    );
    if (agentPick) return { ...base, leg: agentPick.leg, source: agentPick.source, selectedBy: 'agent' };
    if (candidates.length === 1) {
        return { ...base, leg: candidates[0].leg, source: candidates[0].source, selectedBy: 'code' };
    }
    return base;
}
