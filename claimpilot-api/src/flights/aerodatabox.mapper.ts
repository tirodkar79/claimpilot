import type { FlightLeg, FlightStatus } from './flight.types';

/**
 * The parts of an AeroDataBox `GET /flights/number/{number}/{dateLocal}` response we use.
 * Times look like "2026-09-22 13:10Z". Only tested against a hand-written sample so far: verify with a real
 * key before relying on live mode (see SETUP.md).
 */
export interface AeroDataBoxFlight {
    number: string;
    status: string;
    departure: AeroDataBoxMovement;
    arrival: AeroDataBoxMovement;
}

interface AeroDataBoxMovement {
    airport: { iata?: string; timeZone?: string };
    scheduledTime?: { utc: string };
    revisedTime?: { utc: string };
    runwayTime?: { utc: string };
}

const STATUS_MAP: Record<string, FlightStatus> = {
    Arrived: 'landed',
    Departed: 'departed',
    EnRoute: 'departed',
    Approaching: 'departed',
    Canceled: 'cancelled',
    CanceledUncertain: 'cancelled',
    Diverted: 'diverted',
};

/**
 * Converts an AeroDataBox time ("2026-09-22 13:10Z") to ISO 8601.
 * @param value AeroDataBox UTC time.
 */
function toIso(value: string): string {
    return new Date(value.replace(' ', 'T')).toISOString();
}

/**
 * Maps one AeroDataBox flight to a leg. Revised times only count as actual once the status shows the
 * movement happened (before that they are estimates). Legs without scheduled times are skipped.
 * @param flight AeroDataBox flight.
 * @param flightNumber Normalised flight number to report.
 */
export function mapAeroDataBoxFlight(flight: AeroDataBoxFlight, flightNumber: string): FlightLeg | null {
    const { departure, arrival } = flight;
    if (!departure.scheduledTime || !arrival.scheduledTime || !departure.airport.iata || !arrival.airport.iata) {
        return null;
    }
    const status = STATUS_MAP[flight.status] ?? (flight.status === 'Unknown' ? 'unknown' : 'scheduled');
    const departed = status === 'departed' || status === 'landed' || status === 'diverted';
    const actualDeparture = departure.revisedTime ?? departure.runwayTime;
    const actualArrival = arrival.revisedTime ?? arrival.runwayTime;

    return {
        flightNumber,
        status,
        origin: { iata: departure.airport.iata, timeZone: departure.airport.timeZone ?? 'UTC' },
        destination: { iata: arrival.airport.iata, timeZone: arrival.airport.timeZone ?? 'UTC' },
        scheduledDeparture: toIso(departure.scheduledTime.utc),
        scheduledArrival: toIso(arrival.scheduledTime.utc),
        actualDeparture: departed && actualDeparture ? toIso(actualDeparture.utc) : undefined,
        actualArrival: status === 'landed' && actualArrival ? toIso(actualArrival.utc) : undefined,
    };
}
