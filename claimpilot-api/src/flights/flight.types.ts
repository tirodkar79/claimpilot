export const FLIGHT_STATUSES = ['scheduled', 'departed', 'landed', 'cancelled', 'diverted', 'unknown'] as const;
export type FlightStatus = (typeof FLIGHT_STATUSES)[number];

export interface FlightAirport {
    iata: string;
    timeZone: string;
}

/** One leg of a flight number on one day. All times are ISO 8601 in UTC. */
export interface FlightLeg {
    flightNumber: string;
    status: FlightStatus;
    origin: FlightAirport;
    destination: FlightAirport;
    scheduledDeparture: string;
    scheduledArrival: string;
    /** Present once the flight has left the gate. */
    actualDeparture?: string;
    /** Present once the flight has reached the gate. */
    actualArrival?: string;
}

export const FLIGHT_DATA_SOURCES = ['recorded', 'aerodatabox'] as const;
export type FlightDataSource = (typeof FLIGHT_DATA_SOURCES)[number];

/** Result of looking a flight number up on one local departure date. Empty `legs` = not found. */
export interface FlightLookup {
    flightNumber: string;
    date: string;
    legs: FlightLeg[];
    source: FlightDataSource;
}
