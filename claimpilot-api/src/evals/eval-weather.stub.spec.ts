import { AIRPORT_LOCATIONS } from '../weather/airports';
import { WeatherUnavailableError } from '../weather/open-meteo-mcp.service';
import { EvalWeatherStub } from './eval-weather.stub';

const at = (iata: string) => ({
    latitude: AIRPORT_LOCATIONS[iata].latitude,
    longitude: AIRPORT_LOCATIONS[iata].longitude,
    startDate: '2026-09-30',
    endDate: '2026-10-01',
});

describe('EvalWeatherStub', () => {
    it('reports clear weather by default, hourly for every day in the range', async () => {
        const weather = await new EvalWeatherStub().archive(at('DEL'));
        expect(weather.time).toHaveLength(48);
        expect(weather.time[0]).toBe('2026-09-30T00:00');
        expect(new Set(weather.weather_code)).toEqual(new Set([1]));
    });

    it('reports severe weather only at the chosen airport', async () => {
        const stub = new EvalWeatherStub();
        stub.use({ kind: 'severe', airport: 'DEL', weatherCode: 45 });
        expect((await stub.archive(at('DEL'))).weather_code?.[5]).toBe(45);
        expect((await stub.archive(at('BOM'))).weather_code?.[5]).toBe(1);
    });

    it('simulates an outage', async () => {
        const stub = new EvalWeatherStub();
        stub.use({ kind: 'down' });
        await expect(stub.archive(at('DEL'))).rejects.toBeInstanceOf(WeatherUnavailableError);
    });
});
