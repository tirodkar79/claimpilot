import { computeDelay } from './flight-delay';
import type { FlightLeg } from './flight.types';
import { recordedLegs } from './recorded-flights';

const [qp1303] = recordedLegs('QP1303', '2026-09-22'); // 100 min late leaving, 190 min late arriving

describe('computeDelay', () => {
    it('measures departure or arrival as the policy says', () => {
        expect(computeDelay(qp1303, 'departure')).toEqual({ measure: 'departure', minutes: 100, cancelled: false });
        expect(computeDelay(qp1303, 'arrival')).toEqual({ measure: 'arrival', minutes: 190, cancelled: false });
    });

    it('compares in UTC, so local offsets cannot skew the delay', () => {
        const leg: FlightLeg = {
            ...qp1303,
            scheduledDeparture: '2026-09-22T23:30:00.000Z',
            actualDeparture: '2026-09-23T01:15:00.000Z', // crosses midnight UTC
        };
        expect(computeDelay(leg, 'departure').minutes).toBe(105);
    });

    it('reports early departures as negative', () => {
        const leg = {
            ...qp1303,
            actualDeparture: '2026-09-22T00:30:00.000Z',
            scheduledDeparture: '2026-09-22T00:40:00.000Z',
        };
        expect(computeDelay(leg, 'departure').minutes).toBe(-10);
    });

    it('flags cancellations and unknown actual times', () => {
        const [sg160] = recordedLegs('SG160', '2026-09-22');
        expect(computeDelay(sg160, 'departure')).toEqual({ measure: 'departure', minutes: null, cancelled: true });
        expect(computeDelay({ ...qp1303, actualArrival: undefined }, 'arrival').minutes).toBeNull();
    });
});
