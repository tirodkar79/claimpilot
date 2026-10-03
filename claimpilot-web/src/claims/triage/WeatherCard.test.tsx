import { render, screen } from '@testing-library/react';
import type { WeatherFindings } from '../claims.api';
import { WeatherCard } from './WeatherCard';

const findings: WeatherFindings = {
    source: 'open-meteo-mcp',
    severe: true,
    notes: 'Fog at Delhi during the arrival window.',
    guardFetched: ['DEL 2026-09-24'],
    checks: [
        {
            airport: 'BOM',
            role: 'departure',
            windowStart: '2026-09-24T11:10:00.000Z',
            windowEnd: '2026-09-24T17:00:00.000Z',
            severe: false,
            severeObservations: [],
            observationCount: 7,
        },
        {
            airport: 'DEL',
            role: 'arrival',
            windowStart: '2026-09-24T13:20:00.000Z',
            windowEnd: '2026-09-24T18:55:00.000Z',
            severe: true,
            observationCount: 6,
            severeObservations: [
                {
                    time: '2026-09-24T16:00:00.000Z',
                    weatherCode: 45,
                    condition: 'fog',
                    gustKmh: 8,
                    precipitationMm: 0,
                    severe: true,
                },
            ],
        },
    ],
};

describe('WeatherCard', () => {
    it('shows each airport window in local time with the conditions found', () => {
        render(<WeatherCard findings={findings} timeZone="Asia/Kolkata" />);
        expect(screen.getByText('16:40–22:30 · 7h checked')).toBeInTheDocument();
        expect(screen.getByText('no severe weather')).toBeInTheDocument();
        expect(screen.getByText('fog')).toBeInTheDocument();
    });

    it('says which data code had to fetch itself', () => {
        render(<WeatherCard findings={findings} timeZone="Asia/Kolkata" />);
        expect(screen.getByText('Fetched by code because the agent skipped them: DEL 2026-09-24.')).toBeInTheDocument();
    });
});
