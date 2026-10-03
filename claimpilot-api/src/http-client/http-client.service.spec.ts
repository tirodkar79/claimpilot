import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError, AxiosHeaders, AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { RequestContext } from '../request-context/request-context';
import { HttpClientOptions, HttpClientService, retryDelayMs } from './http-client.service';
import { UpstreamError } from './upstream.error';

type ScriptedReply = { status: number; data?: unknown } | { networkError: string };

/**
 * Replaces the network with scripted replies and records a snapshot of every attempt.
 * @param instance Axios instance under test.
 * @param replies Replies returned in order, one per attempt.
 */
function scriptAdapter(instance: AxiosInstance, replies: ScriptedReply[]): InternalAxiosRequestConfig[] {
    const attempts: InternalAxiosRequestConfig[] = [];
    instance.defaults.adapter = async (config) => {
        attempts.push({ ...config }); // snapshot: retries reuse and mutate the same config object
        const reply = replies.shift();
        if (!reply) throw new Error('No scripted reply left');
        if ('networkError' in reply) throw new AxiosError('network failure', reply.networkError, config);

        const response: AxiosResponse = {
            status: reply.status,
            statusText: '',
            headers: {},
            data: reply.data,
            config,
        };
        if (reply.status >= 400) throw new AxiosError('request failed', undefined, config, null, response);
        return response;
    };
    return attempts;
}

const config = {
    get: (key: string) => ({ HTTP_TIMEOUT_MS: 1000, HTTP_MAX_RETRIES: 2 })[key],
} as ConfigService<never, true>;

/**
 * Builds a client through the service with zero backoff and a scripted network.
 * @param replies Replies returned in order, one per attempt.
 * @param options Overrides for the client options.
 */
function createClient(replies: ScriptedReply[], options: Partial<HttpClientOptions> = {}) {
    const instance = new HttpClientService(config).create({
        name: 'flights',
        retryBaseDelayMs: 0,
        ...options,
    });
    return { instance, attempts: scriptAdapter(instance, replies) };
}

beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
});

describe('HttpClientService', () => {
    it('applies env defaults for timeout', () => {
        expect(new HttpClientService(config).create({ name: 'x' }).defaults.timeout).toBe(1000);
    });

    it('returns successful responses untouched', async () => {
        const { instance, attempts } = createClient([{ status: 200, data: { ok: true } }]);
        await expect(instance.get('/status')).resolves.toMatchObject({ status: 200, data: { ok: true } });
        expect(attempts).toHaveLength(1);
    });

    it('retries transient failures and then succeeds', async () => {
        const { instance, attempts } = createClient([{ status: 503 }, { networkError: 'ECONNRESET' }, { status: 200 }]);
        await expect(instance.get('/status')).resolves.toMatchObject({ status: 200 });
        expect(attempts.map((a) => a.retryAttempt ?? 0)).toEqual([0, 1, 2]);
    });

    it('stops after maxRetries and throws an UpstreamError', async () => {
        const { instance, attempts } = createClient([{ status: 502 }, { status: 502 }, { status: 502 }]);
        await expect(instance.get('/status')).rejects.toEqual(
            new UpstreamError('flights', 'flights responded 502', 'UPSTREAM_502', 502, true),
        );
        expect(attempts).toHaveLength(3);
    });

    it('does not retry client errors', async () => {
        const { instance, attempts } = createClient([{ status: 404 }]);
        await expect(instance.get('/status')).rejects.toMatchObject({
            code: 'UPSTREAM_404',
            retriable: false,
        });
        expect(attempts).toHaveLength(1);
    });

    it('does not retry non-idempotent methods', async () => {
        const { instance, attempts } = createClient([{ status: 503 }]);
        await expect(instance.post('/claims', {})).rejects.toMatchObject({ code: 'UPSTREAM_503' });
        expect(attempts).toHaveLength(1);
    });

    it.each([
        ['ECONNABORTED', 'UPSTREAM_TIMEOUT'],
        ['ECONNREFUSED', 'UPSTREAM_UNAVAILABLE'],
    ])('maps %s to %s', async (networkError, code) => {
        const { instance } = createClient([{ networkError }], { maxRetries: 0 });
        await expect(instance.get('/status')).rejects.toMatchObject({ name: 'UpstreamError', code });
    });

    it('forwards the inbound request id', async () => {
        const { instance, attempts } = createClient([{ status: 200 }]);
        await RequestContext.run({ requestId: 'req-42' }, () => instance.get('/status'));
        expect(AxiosHeaders.from(attempts[0].headers).get('x-request-id')).toBe('req-42');
    });
});

/**
 * Builds a 429 axios error, optionally with a `Retry-After` header.
 * @param retryAfter Header value, or undefined to omit it.
 */
function rateLimited(retryAfter?: string): AxiosError {
    const requestConfig = { headers: {} } as InternalAxiosRequestConfig;
    const headers = retryAfter === undefined ? {} : { 'retry-after': retryAfter };
    const response = { status: 429, statusText: '', headers, data: null, config: requestConfig } as AxiosResponse;
    return new AxiosError('rate limited', undefined, requestConfig, null, response);
}

describe('retryDelayMs', () => {
    it('backs off exponentially without Retry-After', () => {
        expect([0, 1, 2].map((attempt) => retryDelayMs(rateLimited(), attempt, 300))).toEqual([300, 600, 1200]);
    });

    it('uses Retry-After seconds, capped at 30s', () => {
        expect(retryDelayMs(rateLimited('2'), 0, 300)).toBe(2000);
        expect(retryDelayMs(rateLimited('600'), 0, 300)).toBe(30_000);
    });

    it('uses a Retry-After HTTP date', () => {
        const inFiveSeconds = new Date(Date.now() + 5000).toUTCString();
        expect(retryDelayMs(rateLimited(inFiveSeconds), 0, 300)).toBeGreaterThan(3000);
    });

    it('falls back to backoff for an unparseable Retry-After', () => {
        expect(retryDelayMs(rateLimited('soon'), 1, 300)).toBe(600);
    });
});
