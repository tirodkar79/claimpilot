import { recordedLegs } from './recorded-flights';

describe('recordedLegs', () => {
    it('builds the leg for the requested date, converting IST to UTC', () => {
        const [leg] = recordedLegs('6E2134', '2026-09-22');
        expect(leg).toMatchObject({
            flightNumber: '6E2134',
            status: 'landed',
            origin: { iata: 'BOM' },
            destination: { iata: 'DEL' },
            scheduledDeparture: '2026-09-22T13:10:00.000Z', // 18:40 IST
            actualDeparture: '2026-09-22T17:00:00.000Z', // +230 min
        });
    });

    it('works for any date, so demos keep working as time passes', () => {
        expect(recordedLegs('6E2134', '2030-01-15')[0].scheduledDeparture).toBe('2030-01-15T13:10:00.000Z');
    });

    it('returns several legs under one number', () => {
        expect(recordedLegs('6E6187', '2026-09-22').map((leg) => leg.origin.iata)).toEqual(['HYD', 'DEL']);
    });

    it('records cancelled flights without actual times', () => {
        expect(recordedLegs('SG160', '2026-09-22')[0]).toMatchObject({
            status: 'cancelled',
            actualDeparture: undefined,
        });
    });

    it('returns nothing for unknown flight numbers', () => {
        expect(recordedLegs('6E2314', '2026-09-22')).toEqual([]);
    });
});
