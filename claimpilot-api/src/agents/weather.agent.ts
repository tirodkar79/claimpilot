import { Agent } from '@mastra/core/agent';
import type { MastraModelConfig } from '@mastra/core/llm';
import { createTool } from '@mastra/core/tools';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { FlightLeg } from '../flights/flight.types';
import type { TraceRecorder } from '../trace/trace.service';
import { airportLocation } from '../weather/airports';
import { OpenMeteoMcpService, WeatherUnavailableError } from '../weather/open-meteo-mcp.service';
import { assessWeather, type HourlyWeather, type WeatherObservation } from '../weather/severe-weather';
import { LANGUAGE_MODEL } from './language-model.provider';

/** Archive calls per claim: two airports, each possibly spanning two UTC dates. */
export const MAX_WEATHER_CALLS = 4;
/** Weather in the hours before the scheduled time can cause the delay, so the window starts earlier. */
const LOOKBACK_MS = 2 * 60 * 60 * 1000;

export interface WeatherCheck {
    airport: string;
    role: 'departure' | 'arrival';
    windowStart: string;
    windowEnd: string;
    severe: boolean;
    severeObservations: WeatherObservation[];
    observationCount: number;
}

/** Weather evidence: one check per airport, computed by code from the MCP data. */
export interface WeatherFindings {
    source: 'open-meteo-mcp';
    severe: boolean;
    checks: WeatherCheck[];
    notes: string;
    /** "AIRPORT DATE" fetches code made because the agent didn't. */
    guardFetched: string[];
}

const weatherNotesSchema = z.object({
    notes: z.string().describe('One or two sentences for a reviewer: the weather at each airport in the window'),
});

const INSTRUCTIONS = `You check the weather at the airports of a delayed flight, for an insurance exclusion.

Use weatherArchive (historical hourly weather, from the Open-Meteo MCP server) for the departure airport and
the arrival airport, for every UTC date the time windows in the prompt touch. Make at most ${MAX_WEATHER_CALLS} calls.
Then describe in one or two sentences what the weather was at each airport during its window.
Don't decide whether the exclusion applies; code does that from the data.`;

interface Window {
    airport: string;
    role: 'departure' | 'arrival';
    from: string;
    to: string;
    dates: string[];
}

/**
 * Checks for severe weather around a flight using the external Open-Meteo MCP server. Its tool only accepts
 * the flight's two airports (coordinates come from code); the severity verdict is computed from the returned
 * data, and any window the agent didn't fetch is fetched by code.
 */
@Injectable()
export class WeatherAgent {
    constructor(
        @Inject(LANGUAGE_MODEL) private readonly model: MastraModelConfig,
        private readonly weather: OpenMeteoMcpService,
    ) {}

    /**
     * Checks both ends of the flight for severe weather during the delay.
     * @param leg Flight leg with scheduled and actual times.
     * @param recorder Trace recorder of the current run.
     * @throws WeatherUnavailableError when the MCP server can't supply the data; or when the model fails.
     */
    async check(leg: FlightLeg, recorder: TraceRecorder): Promise<WeatherFindings> {
        const windows = windowsFor(leg);
        const fetched = new Map<string, HourlyWeather>();
        const fetch = (airport: string, date: string) => this.fetch(airport, date, fetched, recorder);

        const agent = new Agent({
            id: 'weather',
            name: 'Weather',
            instructions: INSTRUCTIONS,
            model: this.model,
            tools: { weatherArchive: this.archiveTool(leg, fetched, fetch, recorder) },
        });
        const prompt = windows
            .map((w) => `${w.role} ${w.airport}: ${w.from} to ${w.to} (UTC dates ${w.dates.join(', ')})`)
            .join('\n');
        const result = await agent.generate(`Flight ${leg.flightNumber}. Time windows:\n${prompt}`, {
            maxSteps: MAX_WEATHER_CALLS + 1,
            structuredOutput: { schema: weatherNotesSchema, jsonPromptInjection: true },
        });
        const { notes } = weatherNotesSchema.parse(result.object);

        const guardFetched: string[] = [];
        for (const window of windows) {
            for (const date of window.dates) {
                if (fetched.has(`${window.airport} ${date}`)) continue;
                await recorder.record(
                    'weather',
                    'guard.enforced',
                    `Agent skipped ${window.airport} ${date}; fetching it`,
                );
                await fetch(window.airport, date);
                guardFetched.push(`${window.airport} ${date}`);
            }
        }

        const checks = windows.map((window): WeatherCheck => {
            const hourly = mergeHourly(window.dates.map((date) => fetched.get(`${window.airport} ${date}`)!));
            const assessment = assessWeather(hourly, window.from, window.to);
            return {
                airport: window.airport,
                role: window.role,
                windowStart: window.from,
                windowEnd: window.to,
                severe: assessment.severe,
                severeObservations: assessment.severeObservations,
                observationCount: assessment.observations.length,
            };
        });
        return { source: 'open-meteo-mcp', severe: checks.some((c) => c.severe), checks, notes, guardFetched };
    }

    /**
     * The tool shown to the model: weather for one of the flight's airports on one UTC date.
     * @param leg Flight leg (limits the airports).
     * @param fetched Data fetched so far.
     * @param fetch Fetches and caches one airport-date.
     * @param recorder Trace recorder.
     */
    private archiveTool(
        leg: FlightLeg,
        fetched: Map<string, HourlyWeather>,
        fetch: (airport: string, date: string) => Promise<HourlyWeather>,
        recorder: TraceRecorder,
    ) {
        const airports = [leg.origin.iata, leg.destination.iata] as [string, ...string[]];
        return createTool({
            id: 'weatherArchive',
            description:
                'Hourly historical weather (UTC) at one of this flight’s airports, via the Open-Meteo MCP server.',
            inputSchema: z.object({
                airport: z.enum(airports),
                date: z.string().describe('UTC date, YYYY-MM-DD'),
            }),
            execute: async ({ airport, date }) => {
                if (!fetched.has(`${airport} ${date}`) && fetched.size >= MAX_WEATHER_CALLS) {
                    await recorder.record('weather', 'tool.called', `weatherArchive(${airport}, ${date}) refused`, {
                        data: { tool: 'weatherArchive', airport, date, refused: true },
                    });
                    return { error: `At most ${MAX_WEATHER_CALLS} weather calls are allowed.` };
                }
                const hourly = await fetch(airport, date);
                return {
                    airport,
                    date,
                    hours: hourly.time.map((time, i) => ({
                        time,
                        weatherCode: hourly.weather_code?.[i] ?? null,
                        gustKmh: hourly.wind_gusts_10m?.[i] ?? null,
                    })),
                };
            },
        });
    }

    /**
     * Fetches one airport-date through the MCP server once per run, tracing the call.
     * @param airport IATA code.
     * @param date UTC date.
     * @param fetched Cache of this run (mutated).
     * @param recorder Trace recorder.
     * @throws WeatherUnavailableError when the airport is unknown or the MCP call fails.
     */
    private async fetch(
        airport: string,
        date: string,
        fetched: Map<string, HourlyWeather>,
        recorder: TraceRecorder,
    ): Promise<HourlyWeather> {
        const key = `${airport} ${date}`;
        const cached = fetched.get(key);
        if (cached) return cached;

        const location = airportLocation(airport);
        if (!location) throw new WeatherUnavailableError(`No coordinates for airport ${airport}`);
        const startedAt = Date.now();
        const hourly = await this.weather.archive({
            latitude: location.latitude,
            longitude: location.longitude,
            startDate: date,
            endDate: date,
        });
        fetched.set(key, hourly);
        await recorder.record('weather', 'tool.called', `weather_archive(${airport}, ${date}) via MCP`, {
            data: { tool: 'weather_archive', server: 'open-meteo', airport, date, hours: hourly.time.length },
            durationMs: Date.now() - startedAt,
        });
        return hourly;
    }
}

/**
 * Time windows to check: from 2 hours before the scheduled time to the actual (or scheduled) time, at each end.
 * @param leg Flight leg.
 */
export function windowsFor(leg: FlightLeg): Window[] {
    const build = (airport: string, role: Window['role'], scheduled: string, actual?: string): Window => {
        const from = new Date(Date.parse(scheduled) - LOOKBACK_MS).toISOString();
        const to = actual ?? scheduled;
        return { airport, role, from, to, dates: [...new Set([from.slice(0, 10), to.slice(0, 10)])] };
    };
    return [
        build(leg.origin.iata, 'departure', leg.scheduledDeparture, leg.actualDeparture),
        build(leg.destination.iata, 'arrival', leg.scheduledArrival, leg.actualArrival),
    ];
}

/**
 * Concatenates hourly series for consecutive dates.
 * @param series One series per date, in date order.
 */
function mergeHourly(series: HourlyWeather[]): HourlyWeather {
    const column = (pick: (s: HourlyWeather) => (number | null)[] | undefined) =>
        series.flatMap((s) => pick(s) ?? s.time.map(() => null));
    /* eslint-disable camelcase -- field names defined by the Open-Meteo API */
    return {
        time: series.flatMap((s) => s.time),
        weather_code: column((s) => s.weather_code),
        wind_gusts_10m: column((s) => s.wind_gusts_10m),
        precipitation: column((s) => s.precipitation),
    };
    /* eslint-enable camelcase */
}
