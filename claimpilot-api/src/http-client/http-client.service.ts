import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig, isAxiosError } from 'axios';
import { REQUEST_ID_HEADER } from '../common/constants/headers.constants';
import { EnvConfig } from '../config/env.validation';
import { RequestContext } from '../request-context/request-context';
import { UpstreamError } from './upstream.error';

const RETRIABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const IDEMPOTENT_METHODS = new Set(['get', 'head', 'options', 'put', 'delete']);
const RETRY_BASE_DELAY_MS = 300;
const MAX_RETRY_AFTER_MS = 30_000;

export interface HttpClientOptions {
    /** Upstream name used in logs and errors, e.g. "aerodatabox". */
    name: string;
    baseURL?: string;
    headers?: Record<string, string>;
    /** Defaults to HTTP_TIMEOUT_MS. */
    timeoutMs?: number;
    /** Defaults to HTTP_MAX_RETRIES. */
    maxRetries?: number;
    /** Defaults to 300ms; doubles on each retry. */
    retryBaseDelayMs?: number;
}

declare module 'axios' {
    interface InternalAxiosRequestConfig {
        startedAt?: number;
        retryAttempt?: number;
    }
}

/**
 * Builds one axios instance per upstream with shared behaviour: forwards the request id, logs each
 * attempt, retries transient failures on idempotent methods, and rejects with `UpstreamError`.
 */
@Injectable()
export class HttpClientService {
    constructor(private readonly config: ConfigService<EnvConfig, true>) {}

    /**
     * Creates an axios instance for one upstream.
     * @param options Upstream name, base URL and optional overrides.
     * @returns Axios instance whose failures reject with `UpstreamError`.
     */
    create(options: HttpClientOptions): AxiosInstance {
        const logger = new Logger(`HttpClient:${options.name}`);
        const maxRetries = options.maxRetries ?? this.config.get('HTTP_MAX_RETRIES', { infer: true });
        const baseDelayMs = options.retryBaseDelayMs ?? RETRY_BASE_DELAY_MS;
        const instance = axios.create({
            baseURL: options.baseURL,
            headers: options.headers,
            timeout: options.timeoutMs ?? this.config.get('HTTP_TIMEOUT_MS', { infer: true }),
        });

        instance.interceptors.request.use((config) => {
            const requestId = RequestContext.requestId();
            if (requestId) config.headers.set(REQUEST_ID_HEADER, requestId);
            config.startedAt = Date.now();
            return config;
        });

        instance.interceptors.response.use(
            (response) => {
                logger.log(`${describe(response.config)} ${response.status} ${elapsedMs(response.config)}ms`);
                return response;
            },
            async (error: unknown) => {
                if (error instanceof UpstreamError || !isAxiosError(error) || !error.config) throw error;

                const config = error.config;
                const attempt = config.retryAttempt ?? 0;
                logger.warn(
                    `${describe(config)} ${error.response?.status ?? error.code} ${elapsedMs(config)}ms attempt=${attempt + 1}`,
                );

                if (attempt < maxRetries && canRetry(error)) {
                    config.retryAttempt = attempt + 1;
                    await sleep(retryDelayMs(error, attempt, baseDelayMs));
                    return instance.request(config);
                }
                throw toUpstreamError(options.name, error);
            },
        );

        return instance;
    }
}

/**
 * Whether a failed request is safe and worth retrying: idempotent method, and a retriable status,
 * timeout or network failure. Cancelled requests are never retried.
 * @param error Failed axios request.
 */
function canRetry(error: AxiosError): boolean {
    if (!IDEMPOTENT_METHODS.has((error.config?.method ?? 'get').toLowerCase())) return false;
    return isTransient(error);
}

/**
 * Whether a failure is transient: a retriable status, a timeout or a network failure.
 * @param error Failed axios request.
 */
function isTransient(error: AxiosError): boolean {
    if (error.response) return RETRIABLE_STATUS_CODES.has(error.response.status);
    return error.code !== AxiosError.ERR_CANCELED;
}

/**
 * Delay before the next attempt: `Retry-After` (seconds or HTTP date, capped at 30s) when present
 * and valid, otherwise `baseDelayMs × 2^attempt`.
 * @param error Failed axios request.
 * @param attempt Retries already made (0 before the first retry).
 * @param baseDelayMs Backoff base.
 */
export function retryDelayMs(error: AxiosError, attempt: number, baseDelayMs: number): number {
    const header = error.response?.headers?.['retry-after'];
    if (header !== undefined) {
        const seconds = Number(header);
        const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(String(header)) - Date.now();
        if (Number.isFinite(ms) && ms >= 0) return Math.min(ms, MAX_RETRY_AFTER_MS);
    }
    return baseDelayMs * 2 ** attempt;
}

/**
 * Converts an axios failure into an `UpstreamError` with a stable code:
 * `UPSTREAM_<status>`, `UPSTREAM_TIMEOUT` or `UPSTREAM_UNAVAILABLE`.
 * @param service Upstream name.
 * @param error Failed axios request.
 */
function toUpstreamError(service: string, error: AxiosError): UpstreamError {
    const status = error.response?.status;
    const retriable = isTransient(error);
    if (status) {
        return new UpstreamError(service, `${service} responded ${status}`, `UPSTREAM_${status}`, status, retriable);
    }
    if (error.code === AxiosError.ECONNABORTED || error.code === AxiosError.ETIMEDOUT) {
        return new UpstreamError(service, `${service} timed out`, 'UPSTREAM_TIMEOUT', undefined, retriable);
    }
    return new UpstreamError(service, `${service} unreachable`, 'UPSTREAM_UNAVAILABLE', undefined, retriable);
}

/**
 * Formats a request as `METHOD baseURL/url` for log lines.
 * @param config Request config of the attempt.
 */
function describe(config: InternalAxiosRequestConfig): string {
    return `${config.method?.toUpperCase()} ${config.baseURL ?? ''}${config.url ?? ''}`;
}

/**
 * Milliseconds since the current attempt started.
 * @param config Request config of the attempt.
 */
function elapsedMs(config: InternalAxiosRequestConfig): number {
    return config.startedAt ? Date.now() - config.startedAt : 0;
}

/**
 * Resolves after the given delay.
 * @param ms Delay in milliseconds.
 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
