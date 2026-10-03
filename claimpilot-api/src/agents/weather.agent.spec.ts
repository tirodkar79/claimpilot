import { recordedLegs } from '../flights/recorded-flights';
import type { TraceRecorder } from '../trace/trace.service';
import type { OpenMeteoMcpService } from '../weather/open-meteo-mcp.service';
import type { HourlyWeather } from '../weather/severe-weather';
import { WeatherAgent, windowsFor } from './weather.agent';
import { mockLanguageModel, type MockStep } from './testing/mock-language-model';

const [leg] = recordedLegs('6E2134', '2026-09-24'); // BOM 13:10Z → 17:00Z; DEL 15:20Z → 18:55Z

/**
 * A day of hourly weather with fog at the given UTC hours.
 * @param date UTC date.
 * @param fogHours Hours with fog (code 45).
 */
function dayWith(date: string, fogHours: number[] = []): HourlyWeather {
    const hours = Array.from({ length: 24 }, (_, hour) => hour);
    return {
        time: hours.map((hour) => `${date}T${String(hour).padStart(2, '0')}:00`),
        weather_code: hours.map((hour) => (fogHours.includes(hour) ? 45 : 1)),
        wind_gusts_10m: hours.map(() => 12),
        precipitation: hours.map(() => 0),
    };
}

/** Recorder that keeps events in memory. */
function memoryRecorder() {
    const events: { type: string; message: string }[] = [];
    const recorder: TraceRecorder = {
        record: async (_actor, type, message) => {
            events.push({ type, message });
            return {} as never;
        },
    };
    return { recorder, events };
}

/**
 * Model that requests the given airport-dates, then answers with notes.
 * @param calls Tool calls to make, in order.
 */
function scripted(calls: { airport: string; date: string }[]) {
    let step = 0;
    return mockLanguageModel((): MockStep => {
        const call = calls[step++];
        return call
            ? { toolCall: { name: 'weatherArchive', input: call } }
            : { text: JSON.stringify({ notes: 'Weather checked at both airports.' }) };
    });
}

describe('windowsFor', () => {
    it('checks from 2 hours before the scheduled time to the actual time at each end', () => {
        expect(windowsFor(leg)).toEqual([
            {
                airport: 'BOM',
                role: 'departure',
                from: '2026-09-24T11:10:00.000Z',
                to: '2026-09-24T17:00:00.000Z',
                dates: ['2026-09-24'],
            },
            {
                airport: 'DEL',
                role: 'arrival',
                from: '2026-09-24T13:20:00.000Z',
                to: '2026-09-24T18:55:00.000Z',
                dates: ['2026-09-24'],
            },
        ]);
    });
});

describe('WeatherAgent', () => {
    it('fetches both airports through the MCP service and finds no severe weather', async () => {
        const archive = jest.fn(async () => dayWith('2026-09-24'));
        const model = scripted([
            { airport: 'BOM', date: '2026-09-24' },
            { airport: 'DEL', date: '2026-09-24' },
        ]);
        const { recorder, events } = memoryRecorder();

        const findings = await new WeatherAgent(model, { archive } as unknown as OpenMeteoMcpService).check(
            leg,
            recorder,
        );

        expect(findings).toMatchObject({ source: 'open-meteo-mcp', severe: false, guardFetched: [] });
        expect(archive).toHaveBeenCalledWith({
            latitude: 19.0896,
            longitude: 72.8656,
            startDate: '2026-09-24',
            endDate: '2026-09-24',
        });
        expect(events.map((e) => e.message)).toEqual([
            'weather_archive(BOM, 2026-09-24) via MCP',
            'weather_archive(DEL, 2026-09-24) via MCP',
        ]);
    });

    it('decides severity from the data, not the model, and fetches what the model skipped', async () => {
        const archive = jest.fn(async ({ latitude }: { latitude: number }) =>
            dayWith('2026-09-24', latitude > 25 ? [16] : []),
        ); // fog at DEL 16:00Z
        const model = scripted([{ airport: 'BOM', date: '2026-09-24' }]); // never asks for DEL
        const { recorder, events } = memoryRecorder();

        const findings = await new WeatherAgent(model, { archive } as unknown as OpenMeteoMcpService).check(
            leg,
            recorder,
        );

        expect(findings.guardFetched).toEqual(['DEL 2026-09-24']);
        expect(events.map((e) => e.type)).toContain('guard.enforced');
        expect(findings.severe).toBe(true);
        expect(findings.checks.find((c) => c.airport === 'DEL')?.severeObservations[0]).toMatchObject({
            condition: 'fog',
            time: '2026-09-24T16:00:00.000Z',
        });
    });

    it('only lets the model ask about the flight’s own airports', async () => {
        const archive = jest.fn(async () => dayWith('2026-09-24'));
        const offeredSchemas: string[] = [];
        const model = mockLanguageModel((call) => {
            offeredSchemas.push(call.toolNames.join(','));
            return { text: JSON.stringify({ notes: 'x' }) };
        });
        await new WeatherAgent(model, { archive } as unknown as OpenMeteoMcpService).check(
            leg,
            memoryRecorder().recorder,
        );
        expect(offeredSchemas[0]).toBe('weatherArchive');
        expect(JSON.stringify(model.doGenerateCalls[0].tools)).toContain('"enum":["BOM","DEL"]');
    });

    it('fails when the MCP service is unavailable, so triage can refer the claim', async () => {
        const archive = jest.fn(async () => Promise.reject(new Error('Open-Meteo MCP failed: timeout')));
        await expect(
            new WeatherAgent(scripted([]), { archive } as unknown as OpenMeteoMcpService).check(
                leg,
                memoryRecorder().recorder,
            ),
        ).rejects.toThrow('timeout');
    });
});
