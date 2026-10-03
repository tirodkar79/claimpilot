import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { OpenMeteoMcpService, parseHourly, WeatherUnavailableError } from './open-meteo-mcp.service';

const listTools = jest.fn();
const disconnect = jest.fn().mockResolvedValue(undefined);
const constructed: unknown[] = [];

jest.mock('@mastra/mcp', () => ({
    MCPClient: jest.fn().mockImplementation((options: unknown) => {
        constructed.push(options);
        return { listTools, disconnect };
    }),
}));

const hourlyText = JSON.stringify({ hourly: { time: ['2026-09-24T00:00'], weather_code: [45] } });
const ok = { content: [{ type: 'text', text: hourlyText }] };
const request = { latitude: 28.56, longitude: 77.1, startDate: '2026-09-24', endDate: '2026-09-24' };

/**
 * Builds the service with a short timeout.
 * @param timeoutMs Per-call budget.
 */
function createService(timeoutMs = 200) {
    const values: Record<string, unknown> = {
        WEATHER_TIMEOUT_MS: timeoutMs,
        OPEN_METEO_MCP_COMMAND: 'npx -y open-meteo-mcp-server',
    };
    return new OpenMeteoMcpService({ get: (key: string) => values[key] } as unknown as ConfigService<never, true>);
}

beforeAll(() => jest.spyOn(Logger.prototype, 'log').mockImplementation());
beforeEach(() => {
    listTools.mockReset();
    constructed.length = 0;
});

describe('OpenMeteoMcpService', () => {
    it('starts the server over stdio and calls only weather_archive with fixed variables', async () => {
        const execute = jest.fn().mockResolvedValue(ok);
        listTools.mockResolvedValue({ openMeteo_weather_archive: { execute }, openMeteo_weather_forecast: {} });

        await expect(createService().archive(request)).resolves.toEqual({
            time: ['2026-09-24T00:00'],
            weather_code: [45],
        });

        expect(constructed[0]).toMatchObject({
            servers: { openMeteo: { command: 'npx', args: ['-y', 'open-meteo-mcp-server'], stderr: 'ignore' } },
        });
        expect(execute).toHaveBeenCalledWith(
            {
                latitude: 28.56,
                longitude: 77.1,
                start_date: '2026-09-24',
                end_date: '2026-09-24',
                hourly: ['weather_code', 'wind_gusts_10m', 'precipitation'],
            },
            {},
        );
    });

    it('connects once and reuses the tool', async () => {
        listTools.mockResolvedValue({ openMeteo_weather_archive: { execute: jest.fn().mockResolvedValue(ok) } });
        const service = createService();
        await service.archive(request);
        await service.archive(request);
        expect(listTools).toHaveBeenCalledTimes(1);
    });

    it('reports a missing tool as unavailable', async () => {
        listTools.mockResolvedValue({});
        await expect(createService().archive(request)).rejects.toBeInstanceOf(WeatherUnavailableError);
    });

    it('turns a failed call into unavailable and reconnects next time', async () => {
        listTools.mockResolvedValue({
            openMeteo_weather_archive: {
                execute: jest.fn().mockRejectedValueOnce(new Error('EPIPE')).mockResolvedValue(ok),
            },
        });
        const service = createService();
        await expect(service.archive(request)).rejects.toThrow('Open-Meteo MCP failed: EPIPE');
        await expect(service.archive(request)).resolves.toBeDefined();
        expect(listTools).toHaveBeenCalledTimes(2);
    });

    it('times out a server that never answers', async () => {
        listTools.mockReturnValue(new Promise(() => undefined));
        await expect(createService(50).archive(request)).rejects.toThrow('timed out after 50ms');
    });

    it('stops the server on shutdown', async () => {
        listTools.mockResolvedValue({ openMeteo_weather_archive: { execute: jest.fn().mockResolvedValue(ok) } });
        const service = createService();
        await service.archive(request);
        await service.onModuleDestroy();
        expect(disconnect).toHaveBeenCalled();
    });
});

describe('parseHourly', () => {
    it.each([
        ['an error result', { isError: true, content: [{ type: 'text', text: 'rate limited' }] }],
        ['no text', { content: [] }],
        ['unreadable JSON', { content: [{ type: 'text', text: '<html>' }] }],
        ['an API error', { content: [{ type: 'text', text: JSON.stringify({ error: true, reason: 'bad date' }) }] }],
        ['no hours', { content: [{ type: 'text', text: JSON.stringify({ hourly: { time: [] } }) }] }],
    ])('rejects %s', (_label, result) => {
        expect(() => parseHourly(result)).toThrow(WeatherUnavailableError);
    });
});
