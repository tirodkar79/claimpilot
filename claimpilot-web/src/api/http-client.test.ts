import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { roleStore } from '../auth/role.store';
import { ApiError } from './api-error';
import { httpClient } from './http-client';

/**
 * Replaces the network with one reply and captures the request that was sent.
 * @param status Status to reply with.
 * @param data Response body.
 */
function replyWith(status: number, data: unknown = {}) {
    const sent: InternalAxiosRequestConfig[] = [];
    httpClient.defaults.adapter = async (config) => {
        sent.push(config);
        const response: AxiosResponse = { status, statusText: '', headers: {}, data, config };
        if (status >= 400) throw new AxiosError('failed', undefined, config, null, response);
        return response;
    };
    return sent;
}

describe('httpClient', () => {
    afterEach(() => roleStore.set('claimant'));

    it('sends the API key of the active role', async () => {
        const sent = replyWith(200);
        await httpClient.get('/health');
        roleStore.set('reviewer');
        await httpClient.get('/health');

        const keys = sent.map((config) => AxiosHeaders.from(config.headers).get('x-api-key'));
        expect(keys).toEqual(['claimant-key', 'reviewer-key']);
    });

    it('rejects with ApiError built from the API error body', async () => {
        replyWith(404, { error: { code: 'NOT_FOUND', message: 'Claim not found', requestId: 'req-9' } });

        const error = await httpClient.get('/claims/x').catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({
            code: 'NOT_FOUND',
            message: 'Claim not found',
            status: 404,
            requestId: 'req-9',
        });
    });

    it('falls back to HTTP_<status> when the body has no error envelope', async () => {
        replyWith(502, '<html>Bad gateway</html>');
        await expect(httpClient.get('/health')).rejects.toMatchObject({ code: 'HTTP_502', status: 502 });
    });

    it('maps a missing response to NETWORK_ERROR', async () => {
        httpClient.defaults.adapter = async (config) => {
            throw new AxiosError('Network Error', AxiosError.ERR_NETWORK, config);
        };
        await expect(httpClient.get('/health')).rejects.toMatchObject({
            code: 'NETWORK_ERROR',
            status: undefined,
        });
    });
});
