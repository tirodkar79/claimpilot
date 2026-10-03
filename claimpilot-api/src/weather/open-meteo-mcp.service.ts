import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MCPClient } from '@mastra/mcp';
import { EnvConfig } from '../config/env.validation';
import type { HourlyWeather } from './severe-weather';

/** The only Open-Meteo MCP tool ClaimPilot uses; the server's other 16 tools are never exposed. */
const ARCHIVE_TOOL = 'openMeteo_weather_archive';
export const HOURLY_VARIABLES = ['weather_code', 'wind_gusts_10m', 'precipitation'] as const;

export interface ArchiveRequest {
    latitude: number;
    longitude: number;
    /** UTC dates, YYYY-MM-DD. */
    startDate: string;
    endDate: string;
}

/** The weather source could not answer (server didn't start, timed out, or returned an error). */
export class WeatherUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'WeatherUnavailableError';
    }
}

type McpTool = { execute?: (input: unknown, context: unknown) => Promise<unknown> };

/**
 * Client for the external Open-Meteo MCP server, started as a child process over stdio on first use and
 * stopped on shutdown. Every call has a time budget; any failure becomes `WeatherUnavailableError`, which
 * triage turns into REFER.
 */
@Injectable()
export class OpenMeteoMcpService implements OnModuleDestroy {
    private readonly logger = new Logger(OpenMeteoMcpService.name);
    private readonly timeoutMs: number;
    private readonly command: string[];
    private client?: MCPClient;
    private archiveTool?: Promise<McpTool>;

    constructor(config: ConfigService<EnvConfig, true>) {
        this.timeoutMs = config.get('WEATHER_TIMEOUT_MS', { infer: true });
        this.command = config.get('OPEN_METEO_MCP_COMMAND', { infer: true }).split(/\s+/);
    }

    /**
     * Hourly UTC weather for a point and date range from the ERA5 archive.
     * @param request Coordinates and UTC date range.
     * @throws WeatherUnavailableError on any failure or timeout.
     */
    async archive(request: ArchiveRequest): Promise<HourlyWeather> {
        try {
            const tool = await this.withTimeout(this.tool(), 'starting the MCP server');
            const result = await this.withTimeout(
                tool.execute!(
                    {
                        latitude: request.latitude,
                        longitude: request.longitude,
                        /* eslint-disable camelcase -- parameter names defined by the Open-Meteo API */
                        start_date: request.startDate,
                        end_date: request.endDate,
                        /* eslint-enable camelcase */
                        hourly: [...HOURLY_VARIABLES],
                    },
                    {},
                ),
                'weather_archive',
            );
            return parseHourly(result);
        } catch (error) {
            if (error instanceof WeatherUnavailableError) throw error;
            // Drop the cached tool so the next claim retries the connection.
            this.archiveTool = undefined;
            throw new WeatherUnavailableError(`Open-Meteo MCP failed: ${(error as Error).message}`);
        }
    }

    /** Stops the MCP server child process. */
    async onModuleDestroy(): Promise<void> {
        await this.client?.disconnect().catch(() => undefined);
    }

    /** Connects once and returns the archive tool. */
    private tool(): Promise<McpTool> {
        this.archiveTool ??= (async () => {
            const [command, ...args] = this.command;
            this.client ??= new MCPClient({
                id: 'claimpilot-open-meteo',
                servers: { openMeteo: { command, args, timeout: this.timeoutMs, stderr: 'ignore' } },
            });
            const tools = (await this.client.listTools()) as Record<string, McpTool>;
            const archive = tools[ARCHIVE_TOOL];
            if (!archive?.execute) throw new WeatherUnavailableError(`MCP server has no ${ARCHIVE_TOOL} tool`);
            this.logger.log('Connected to the Open-Meteo MCP server');
            return archive;
        })();
        return this.archiveTool;
    }

    /**
     * Rejects with `WeatherUnavailableError` if the work takes longer than the budget.
     * @param work Promise to bound.
     * @param what Name for the error message.
     */
    private withTimeout<T>(work: Promise<T>, what: string): Promise<T> {
        let timer: NodeJS.Timeout;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(
                () => reject(new WeatherUnavailableError(`${what} timed out after ${this.timeoutMs}ms`)),
                this.timeoutMs,
            );
        });
        return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
    }
}

/**
 * Extracts the hourly series from an MCP tool result (`{ content: [{ type: 'text', text: '<json>' }] }`).
 * @param result Raw tool result.
 * @throws WeatherUnavailableError when the result has no hourly data or is an error.
 */
export function parseHourly(result: unknown): HourlyWeather {
    const content = (result as { content?: { type: string; text?: string }[]; isError?: boolean })?.content;
    const text = content?.find((part) => part.type === 'text')?.text;
    if (!text || (result as { isError?: boolean }).isError) {
        const detail = text ? ': ' + text.slice(0, 120) : '';
        throw new WeatherUnavailableError(`Open-Meteo returned no data${detail}`);
    }
    let parsed: { hourly?: HourlyWeather; error?: boolean; reason?: string };
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new WeatherUnavailableError('Open-Meteo returned unreadable data');
    }
    if (parsed.error || !parsed.hourly?.time?.length) {
        const detail = parsed.reason ? ': ' + parsed.reason : '';
        throw new WeatherUnavailableError(`Open-Meteo returned no hourly data${detail}`);
    }
    return parsed.hourly;
}
