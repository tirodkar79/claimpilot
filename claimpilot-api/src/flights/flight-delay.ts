import type { DelayMeasure } from '../policies/policy.schema';
import type { FlightLeg } from './flight.types';

export interface DelayResult {
    measure: DelayMeasure;
    /** Minutes late against the schedule; negative when early. Null when the actual time isn't known. */
    minutes: number | null;
    cancelled: boolean;
}

const MINUTE_MS = 60_000;

/**
 * Delay as the policy defines it: scheduled vs actual departure, or scheduled vs actual arrival.
 * Times are compared in UTC, so time zones can't skew the result.
 * @param leg Flight leg.
 * @param measure Which end of the flight the policy measures.
 */
export function computeDelay(leg: FlightLeg, measure: DelayMeasure): DelayResult {
    if (leg.status === 'cancelled') return { measure, minutes: null, cancelled: true };

    const [scheduled, actual] =
        measure === 'departure'
            ? [leg.scheduledDeparture, leg.actualDeparture]
            : [leg.scheduledArrival, leg.actualArrival];
    if (!actual) return { measure, minutes: null, cancelled: false };

    return { measure, minutes: Math.round((Date.parse(actual) - Date.parse(scheduled)) / MINUTE_MS), cancelled: false };
}
