import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosInstance } from 'axios';
import { EnvConfig } from '../config/env.validation';
import { HttpClientService } from '../http-client/http-client.service';
import { UpstreamError } from '../http-client/upstream.error';
import { AeroDataBoxFlight, mapAeroDataBoxFlight } from './aerodatabox.mapper';
import type { FlightLeg, FlightLookup } from './flight.types';
import { recordedLegs } from './recorded-flights';

/**
 * Looks flights up in recorded data (default) or AeroDataBox (`FLIGHT_DATA_MODE=live`). Live calls go
 * through the shared HTTP client, so they get request ids, logging, retries and `UpstreamError`s.
 */
@Injectable()
export class FlightDataService {
    private readonly live?: AxiosInstance;

    constructor(config: ConfigService<EnvConfig, true>, http: HttpClientService) {
        if (config.get('FLIGHT_DATA_MODE', { infer: true }) === 'live') {
            const host = config.get('AERODATABOX_HOST', { infer: true });
            this.live = http.create({
                name: 'aerodatabox',
                baseURL: `https://${host}`,
                headers: { 'X-RapidAPI-Key': config.get('AERODATABOX_API_KEY') ?? '', 'X-RapidAPI-Host': host },
            });
        }
    }

    /**
     * Legs flown under a flight number on a local departure date.
     * @param flightNumber Normalised flight number, e.g. "6E2134".
     * @param date Local departure date (YYYY-MM-DD).
     * @throws UpstreamError when live lookup fails (not found is an empty result, not an error).
     */
    async lookup(flightNumber: string, date: string): Promise<FlightLookup> {
        if (!this.live) return { flightNumber, date, legs: recordedLegs(flightNumber, date), source: 'recorded' };

        try {
            const { data, status } = await this.live.get<AeroDataBoxFlight[] | ''>(
                `/flights/number/${encodeURIComponent(flightNumber)}/${date}`,
                { params: { withAircraftImage: false, withLocation: false } },
            );
            const flights = status === 204 || !data ? [] : data;
            const legs = flights
                .map((flight) => mapAeroDataBoxFlight(flight, flightNumber))
                .filter((leg): leg is FlightLeg => leg !== null);
            return { flightNumber, date, legs, source: 'aerodatabox' };
        } catch (error) {
            if (error instanceof UpstreamError && error.status === 404) {
                return { flightNumber, date, legs: [], source: 'aerodatabox' };
            }
            throw error;
        }
    }
}
