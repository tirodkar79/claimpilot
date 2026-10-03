import { AIRPORT_LOCATIONS } from '../weather/airports';
import { WeatherUnavailableError, type ArchiveRequest } from '../weather/open-meteo-mcp.service';
import type { HourlyWeather } from '../weather/severe-weather';
import type { EvalWeather } from './evals.constants';

const DAY_MS = 24 * 60 * 60 * 1000;
const CLEAR_SKY = 1;

/**
 * Stands in for the Open-Meteo MCP server during evals, so each case controls the weather it needs (real
 * weather on a recent date is almost always clear). The real server is exercised by the app and its tests.
 */
export class EvalWeatherStub {
    private weather: EvalWeather = { kind: 'clear' };

    /**
     * Sets the weather for the next case.
     * @param weather Clear, severe at one airport all day, or source down.
     */
    use(weather: EvalWeather = { kind: 'clear' }): void {
        this.weather = weather;
    }

    /**
     * Same contract as `OpenMeteoMcpService.archive`: hourly UTC weather for every day in the range.
     * @param request Coordinates and UTC date range.
     * @throws WeatherUnavailableError when the case simulates an outage.
     */
    async archive({ latitude, longitude, startDate, endDate }: ArchiveRequest): Promise<HourlyWeather> {
        if (this.weather.kind === 'down') throw new WeatherUnavailableError('Open-Meteo MCP failed: simulated outage');

        const airport = Object.values(AIRPORT_LOCATIONS).find(
            (location) => location.latitude === latitude && location.longitude === longitude,
        )?.iata;
        const code =
            this.weather.kind === 'severe' && this.weather.airport === airport ? this.weather.weatherCode : CLEAR_SKY;

        const time: string[] = [];
        for (let day = Date.parse(startDate); day <= Date.parse(endDate); day += DAY_MS) {
            const date = new Date(day).toISOString().slice(0, 10);
            for (let hour = 0; hour < 24; hour++) time.push(`${date}T${String(hour).padStart(2, '0')}:00`);
        }
        /* eslint-disable camelcase -- field names defined by the Open-Meteo API */
        return {
            time,
            weather_code: time.map(() => code),
            wind_gusts_10m: time.map(() => 10),
            precipitation: time.map(() => 0),
        };
        /* eslint-enable camelcase */
    }
}
