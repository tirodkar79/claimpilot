import type { ConfigService } from '@nestjs/config';
import type { AxiosInstance } from 'axios';
import type { HttpClientService } from '../http-client/http-client.service';
import { UpstreamError } from '../http-client/upstream.error';
import { FlightDataService } from './flight-data.service';

/**
 * Builds the service with the given mode and a stubbed HTTP client.
 * @param mode Flight data mode.
 * @param get Stub for the live client's GET.
 */
function createService(mode: 'fixtures' | 'live', get = jest.fn()) {
    const values: Record<string, unknown> = {
        FLIGHT_DATA_MODE: mode,
        AERODATABOX_API_KEY: 'rapid-key',
        AERODATABOX_HOST: 'aerodatabox.p.rapidapi.com',
    };
    const config = { get: (key: string) => values[key] } as unknown as ConfigService<never, true>;
    const create = jest.fn().mockReturnValue({ get } as unknown as AxiosInstance);
    return { service: new FlightDataService(config, { create } as unknown as HttpClientService), create, get };
}

describe('FlightDataService', () => {
    it('uses recorded flights by default and never creates a live client', async () => {
        const { service, create } = createService('fixtures');
        const lookup = await service.lookup('6E2134', '2026-09-22');
        expect(lookup).toMatchObject({ source: 'recorded', legs: [{ origin: { iata: 'BOM' } }] });
        expect(create).not.toHaveBeenCalled();
    });

    it('calls AeroDataBox in live mode with the RapidAPI headers', async () => {
        const { service, create, get } = createService('live');
        get.mockResolvedValue({ status: 200, data: [] });

        await service.lookup('6E2134', '2026-09-22');

        expect(create).toHaveBeenCalledWith({
            name: 'aerodatabox',
            baseURL: 'https://aerodatabox.p.rapidapi.com',
            headers: { 'X-RapidAPI-Key': 'rapid-key', 'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com' },
        });
        expect(get).toHaveBeenCalledWith('/flights/number/6E2134/2026-09-22', expect.anything());
    });

    it.each([
        ['204 No Content', () => Promise.resolve({ status: 204, data: '' })],
        ['404', () => Promise.reject(new UpstreamError('aerodatabox', 'x', 'UPSTREAM_404', 404, false))],
    ])('treats %s as not found', async (_label, reply) => {
        const { service, get } = createService('live');
        get.mockImplementation(reply);
        await expect(service.lookup('6E2314', '2026-09-22')).resolves.toMatchObject({
            legs: [],
            source: 'aerodatabox',
        });
    });

    it('rethrows other upstream failures', async () => {
        const { service, get } = createService('live');
        get.mockRejectedValue(new UpstreamError('aerodatabox', 'x', 'UPSTREAM_429', 429, true));
        await expect(service.lookup('6E2134', '2026-09-22')).rejects.toMatchObject({ code: 'UPSTREAM_429' });
    });
});
