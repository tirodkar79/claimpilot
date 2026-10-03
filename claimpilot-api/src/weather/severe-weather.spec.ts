import { assessWeather, HourlyWeather } from './severe-weather';

/**
 * Hourly UTC series for one day with the given weather codes and gusts per hour.
 * @param codes Weather code per hour (24 values).
 * @param gusts Gusts per hour; defaults to calm.
 */
function day(codes: number[], gusts: number[] = codes.map(() => 10)): HourlyWeather {
    return {
        time: codes.map((_, hour) => `2026-09-24T${String(hour).padStart(2, '0')}:00`),
        weather_code: codes,
        wind_gusts_10m: gusts,
        precipitation: codes.map(() => 0),
    };
}

const calm = Array<number>(24).fill(1);

describe('assessWeather', () => {
    it('finds no severe weather on a calm day', () => {
        const result = assessWeather(day(calm), '2026-09-24T11:10:00.000Z', '2026-09-24T17:00:00.000Z');
        expect(result.severe).toBe(false);
        expect(result.observations.map((o) => o.time.slice(11, 13))).toEqual([
            '11',
            '12',
            '13',
            '14',
            '15',
            '16',
            '17',
        ]);
    });

    it('flags fog inside the window and names it', () => {
        const codes = [...calm];
        codes[14] = 45;
        const result = assessWeather(day(codes), '2026-09-24T11:10:00.000Z', '2026-09-24T17:00:00.000Z');
        expect(result.severe).toBe(true);
        expect(result.severeObservations).toEqual([
            expect.objectContaining({ time: '2026-09-24T14:00:00.000Z', weatherCode: 45, condition: 'fog' }),
        ]);
    });

    it('ignores severe weather outside the window', () => {
        const codes = [...calm];
        codes[3] = 95;
        expect(assessWeather(day(codes), '2026-09-24T11:10:00.000Z', '2026-09-24T17:00:00.000Z').severe).toBe(false);
    });

    it('treats storm-force gusts as severe even without a severe code', () => {
        const gusts = calm.map((_, hour) => (hour === 12 ? 72 : 10));
        expect(assessWeather(day(calm, gusts), '2026-09-24T11:00:00.000Z', '2026-09-24T13:00:00.000Z').severe).toBe(
            true,
        );
    });

    it('does not count light rain or cloud as severe', () => {
        const codes = calm.map((_, hour) => (hour % 2 ? 61 : 3));
        expect(assessWeather(day(codes), '2026-09-24T00:00:00.000Z', '2026-09-24T23:00:00.000Z').severe).toBe(false);
    });
});
