import { AeroDataBoxFlight, mapAeroDataBoxFlight } from './aerodatabox.mapper';

const arrived: AeroDataBoxFlight = {
    number: '6E 2134',
    status: 'Arrived',
    departure: {
        airport: { iata: 'BOM', timeZone: 'Asia/Kolkata' },
        scheduledTime: { utc: '2026-09-22 13:10Z' },
        revisedTime: { utc: '2026-09-22 17:00Z' },
    },
    arrival: {
        airport: { iata: 'DEL', timeZone: 'Asia/Kolkata' },
        scheduledTime: { utc: '2026-09-22 15:20Z' },
        revisedTime: { utc: '2026-09-22 18:55Z' },
    },
};

describe('mapAeroDataBoxFlight', () => {
    it('maps an arrived flight with actual times', () => {
        expect(mapAeroDataBoxFlight(arrived, '6E2134')).toEqual({
            flightNumber: '6E2134',
            status: 'landed',
            origin: { iata: 'BOM', timeZone: 'Asia/Kolkata' },
            destination: { iata: 'DEL', timeZone: 'Asia/Kolkata' },
            scheduledDeparture: '2026-09-22T13:10:00.000Z',
            scheduledArrival: '2026-09-22T15:20:00.000Z',
            actualDeparture: '2026-09-22T17:00:00.000Z',
            actualArrival: '2026-09-22T18:55:00.000Z',
        });
    });

    it('treats revised times as estimates until the flight has moved', () => {
        const leg = mapAeroDataBoxFlight({ ...arrived, status: 'Delayed' }, '6E2134');
        expect(leg).toMatchObject({ status: 'scheduled', actualDeparture: undefined, actualArrival: undefined });
    });

    it('keeps the departure but not the arrival while en route', () => {
        const leg = mapAeroDataBoxFlight({ ...arrived, status: 'EnRoute' }, '6E2134');
        expect(leg).toMatchObject({ status: 'departed', actualDeparture: '2026-09-22T17:00:00.000Z' });
        expect(leg?.actualArrival).toBeUndefined();
    });

    it('falls back to runway time and maps cancellations', () => {
        const runway = { ...arrived.departure, revisedTime: undefined, runwayTime: { utc: '2026-09-22 17:10Z' } };
        expect(mapAeroDataBoxFlight({ ...arrived, departure: runway }, '6E2134')?.actualDeparture).toBe(
            '2026-09-22T17:10:00.000Z',
        );
        expect(mapAeroDataBoxFlight({ ...arrived, status: 'Canceled' }, '6E2134')?.status).toBe('cancelled');
    });

    it('skips legs without scheduled times or airports', () => {
        const noSchedule = { ...arrived, departure: { ...arrived.departure, scheduledTime: undefined } };
        expect(mapAeroDataBoxFlight(noSchedule, '6E2134')).toBeNull();
    });
});
