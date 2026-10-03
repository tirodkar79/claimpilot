export interface AirportLocation {
    iata: string;
    name: string;
    latitude: number;
    longitude: number;
}

/** Coordinates of the airports in the demo data. Weather is looked up at these points. */
export const AIRPORT_LOCATIONS: Record<string, AirportLocation> = {
    BOM: { iata: 'BOM', name: 'Mumbai', latitude: 19.0896, longitude: 72.8656 },
    DEL: { iata: 'DEL', name: 'Delhi', latitude: 28.5562, longitude: 77.1 },
    GOI: { iata: 'GOI', name: 'Goa (Dabolim)', latitude: 15.3808, longitude: 73.8314 },
    HYD: { iata: 'HYD', name: 'Hyderabad', latitude: 17.2403, longitude: 78.4294 },
    SXR: { iata: 'SXR', name: 'Srinagar', latitude: 33.9871, longitude: 74.7742 },
};

/**
 * Location of an airport, or undefined when it isn't in the table (weather can't be checked there).
 * @param iata IATA code.
 */
export function airportLocation(iata: string): AirportLocation | undefined {
    return AIRPORT_LOCATIONS[iata];
}
