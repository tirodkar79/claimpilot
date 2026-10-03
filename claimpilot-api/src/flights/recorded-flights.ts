import type { FlightAirport, FlightLeg } from './flight.types';

const AIRPORTS = {
    BOM: { iata: 'BOM', timeZone: 'Asia/Kolkata' },
    DEL: { iata: 'DEL', timeZone: 'Asia/Kolkata' },
    GOI: { iata: 'GOI', timeZone: 'Asia/Kolkata' },
    HYD: { iata: 'HYD', timeZone: 'Asia/Kolkata' },
    SXR: { iata: 'SXR', timeZone: 'Asia/Kolkata' },
} satisfies Record<string, FlightAirport>;

/** India Standard Time is UTC+05:30 all year (no daylight saving). */
const IST_OFFSET = '+05:30';
const MINUTE_MS = 60_000;

interface RecordedLeg {
    origin: FlightAirport;
    destination: FlightAirport;
    /** Scheduled local departure time (HH:mm, IST). */
    departs: string;
    blockMinutes: number;
    /** Minutes late at departure and arrival; omit both for a cancelled flight. */
    departureDelay?: number;
    arrivalDelay?: number;
}

/**
 * Recorded flight patterns, one per flight number, covering the eval scenarios. Applied to whatever date
 * is asked for, so demos and evals keep working as time passes. Unknown numbers (e.g. 6E2314) are "not found".
 */
const RECORDED: Record<string, RecordedLeg[]> = {
    // 3h50m late at departure: meets the 2h tier, not the 4h tier the claimant asked for.
    '6E2134': [
        {
            origin: AIRPORTS.BOM,
            destination: AIRPORTS.DEL,
            departs: '18:40',
            blockMinutes: 130,
            departureDelay: 230,
            arrivalDelay: 215,
        },
    ],
    // 1h20m late: below every tier.
    AI865: [
        {
            origin: AIRPORTS.BOM,
            destination: AIRPORTS.DEL,
            departs: '10:00',
            blockMinutes: 135,
            departureDelay: 80,
            arrivalDelay: 70,
        },
    ],
    // 6h40m late: top tier.
    UK951: [
        {
            origin: AIRPORTS.DEL,
            destination: AIRPORTS.BOM,
            departs: '07:15',
            blockMinutes: 140,
            departureDelay: 400,
            arrivalDelay: 390,
        },
    ],
    // Cancelled.
    SG160: [{ origin: AIRPORTS.BOM, destination: AIRPORTS.DEL, departs: '21:00', blockMinutes: 130 }],
    // Departure 1h40m late but arrival 3h10m late: tier depends on how the policy measures delay.
    QP1303: [
        {
            origin: AIRPORTS.BOM,
            destination: AIRPORTS.GOI,
            departs: '06:10',
            blockMinutes: 75,
            departureDelay: 100,
            arrivalDelay: 190,
        },
    ],
    // Two legs under one number: the claimed route decides which leg counts.
    '6E6187': [
        {
            origin: AIRPORTS.HYD,
            destination: AIRPORTS.DEL,
            departs: '05:30',
            blockMinutes: 130,
            departureDelay: 30,
            arrivalDelay: 25,
        },
        {
            origin: AIRPORTS.DEL,
            destination: AIRPORTS.SXR,
            departs: '09:30',
            blockMinutes: 90,
            departureDelay: 150,
            arrivalDelay: 160,
        },
    ],
};

/**
 * Recorded legs of a flight on a local departure date (IST).
 * @param flightNumber Normalised flight number, e.g. "6E2134".
 * @param date Local departure date (YYYY-MM-DD).
 * @returns Legs flown that day; empty when the number isn't recorded.
 */
export function recordedLegs(flightNumber: string, date: string): FlightLeg[] {
    return (RECORDED[flightNumber] ?? []).map((leg) => {
        const scheduledDeparture = new Date(`${date}T${leg.departs}:00${IST_OFFSET}`).getTime();
        const scheduledArrival = scheduledDeparture + leg.blockMinutes * MINUTE_MS;
        const cancelled = leg.departureDelay === undefined;
        return {
            flightNumber,
            status: cancelled ? 'cancelled' : 'landed',
            origin: leg.origin,
            destination: leg.destination,
            scheduledDeparture: new Date(scheduledDeparture).toISOString(),
            scheduledArrival: new Date(scheduledArrival).toISOString(),
            actualDeparture: cancelled
                ? undefined
                : new Date(scheduledDeparture + (leg.departureDelay ?? 0) * MINUTE_MS).toISOString(),
            actualArrival: cancelled
                ? undefined
                : new Date(scheduledArrival + (leg.arrivalDelay ?? 0) * MINUTE_MS).toISOString(),
        };
    });
}
