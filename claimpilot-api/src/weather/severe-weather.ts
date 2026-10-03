/** Hourly series as returned by Open-Meteo (times in UTC, "YYYY-MM-DDTHH:mm"). */
export interface HourlyWeather {
    time: string[];
    weather_code?: (number | null)[];
    wind_gusts_10m?: (number | null)[];
    precipitation?: (number | null)[];
}

export interface WeatherObservation {
    time: string;
    weatherCode: number | null;
    condition: string;
    gustKmh: number | null;
    precipitationMm: number | null;
    severe: boolean;
}

export interface WeatherAssessment {
    severe: boolean;
    /** Observations inside the window, in time order. */
    observations: WeatherObservation[];
    /** Severe observations only, for citing in the decision. */
    severeObservations: WeatherObservation[];
}

/**
 * WMO weather codes that count as severe weather for a delay exclusion: fog, heavy rain or showers, snow,
 * thunderstorms. Light rain and cloud don't.
 */
const SEVERE_CODES: Record<number, string> = {
    45: 'fog',
    48: 'freezing fog',
    65: 'heavy rain',
    67: 'heavy freezing rain',
    73: 'moderate snow',
    75: 'heavy snow',
    77: 'snow grains',
    82: 'violent rain showers',
    86: 'heavy snow showers',
    95: 'thunderstorm',
    96: 'thunderstorm with hail',
    99: 'thunderstorm with heavy hail',
};

/** Gusts at or above this are treated as storm-force for airport operations. */
export const SEVERE_GUST_KMH = 60;

/**
 * Plain-language condition for a WMO weather code.
 * @param code WMO weather code.
 */
function describe(code: number | null): string {
    if (code === null) return 'no data';
    if (SEVERE_CODES[code]) return SEVERE_CODES[code];
    if (code === 0) return 'clear';
    if (code <= 3) return 'cloud';
    if (code <= 67) return 'rain or drizzle';
    if (code <= 86) return 'snow or showers';
    return 'other';
}

/**
 * Checks hourly weather for severe conditions inside a time window. Deterministic: the decision never
 * depends on how a model reads the weather.
 * @param hourly Hourly series in UTC.
 * @param from Window start (ISO instant); the hour containing it is included.
 * @param to Window end (ISO instant); the hour containing it is included.
 */
export function assessWeather(hourly: HourlyWeather, from: string, to: string): WeatherAssessment {
    const start = Math.floor(Date.parse(from) / 3_600_000) * 3_600_000;
    const end = Date.parse(to);

    const observations: WeatherObservation[] = [];
    hourly.time.forEach((time, index) => {
        const at = Date.parse(`${time}:00Z`);
        if (at < start || at > end) return;
        const weatherCode = hourly.weather_code?.[index] ?? null;
        const gustKmh = hourly.wind_gusts_10m?.[index] ?? null;
        observations.push({
            time: new Date(at).toISOString(),
            weatherCode,
            condition: describe(weatherCode),
            gustKmh,
            precipitationMm: hourly.precipitation?.[index] ?? null,
            severe: (weatherCode !== null && weatherCode in SEVERE_CODES) || (gustKmh ?? 0) >= SEVERE_GUST_KMH,
        });
    });

    const severeObservations = observations.filter((observation) => observation.severe);
    return { severe: severeObservations.length > 0, observations, severeObservations };
}
