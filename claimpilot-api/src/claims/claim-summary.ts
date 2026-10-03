import type { FlightFindings } from '../agents/flight.agent';
import type { PolicyFindings } from '../agents/policy.agent';
import type { WeatherFindings } from '../agents/weather.agent';
import { localDateTime } from '../common/utils/local-date';
import { computeDelay } from '../flights/flight-delay';
import type { Policy } from '../policies/policy.schema';
import type { GroundingAllowList } from '../safety/summary-grounding';
import type { ClaimFacts } from './claim-facts';

export interface SummaryEvidence {
    facts: ClaimFacts;
    policy: Policy | null;
    policyFindings?: PolicyFindings;
    flight?: FlightFindings;
    weather?: WeatherFindings;
}

/**
 * Splits an instant into local date and "HH:mm".
 * @param iso ISO instant.
 * @param timeZone IANA time zone.
 */
function local(iso: string, timeZone: string): { date: string; time: string } {
    const [date, time] = localDateTime(iso, timeZone).split(' ');
    return { date, time };
}

/**
 * Everything a summary may legitimately mention, derived from the evidence alone.
 * @param evidence Facts, policy and findings of the run.
 */
export function groundingAllowList({ facts, policy, flight, weather }: SummaryEvidence): GroundingAllowList {
    const allowed: GroundingAllowList = {
        clauses: new Set(policy?.clauses.map((clause) => clause.id)),
        flightNumbers: new Set([facts.flightNumber, flight?.leg?.flightNumber].filter((v): v is string => !!v)),
        times: new Set(),
        dates: new Set([facts.flightDate, policy?.coverageStart, policy?.coverageEnd].filter((v): v is string => !!v)),
        amounts: new Set(policy?.payoutTiers.map((tier) => tier.amount)),
        minutes: new Set([facts.claimedDelayMinutes].filter((v): v is number => v !== null)),
    };

    const addInstant = (iso: string | undefined, timeZone: string) => {
        if (!iso) return;
        const { date, time } = local(iso, timeZone);
        allowed.dates.add(date);
        allowed.times.add(time);
    };
    const leg = flight?.leg;
    if (leg) {
        addInstant(leg.scheduledDeparture, leg.origin.timeZone);
        addInstant(leg.actualDeparture, leg.origin.timeZone);
        addInstant(leg.scheduledArrival, leg.destination.timeZone);
        addInstant(leg.actualArrival, leg.destination.timeZone);
        for (const measure of ['departure', 'arrival'] as const) {
            const { minutes } = computeDelay(leg, measure);
            if (minutes !== null) allowed.minutes.add(Math.max(0, minutes));
        }
        for (const check of weather?.checks ?? []) {
            const timeZone = check.role === 'departure' ? leg.origin.timeZone : leg.destination.timeZone;
            addInstant(check.windowStart, timeZone);
            addInstant(check.windowEnd, timeZone);
            check.severeObservations.forEach((observation) => addInstant(observation.time, timeZone));
        }
    }
    return allowed;
}

/**
 * Plain summary built only from evidence: used when the orchestrator's summary isn't grounded or is missing.
 * @param evidence Facts, policy and findings of the run.
 */
export function evidenceSummary({ facts, policy, policyFindings, flight, weather }: SummaryEvidence): string {
    const parts: string[] = [];
    if (policy) {
        const exclusions = policyFindings?.relevantExclusions.map((e) => `§${e.clauseId}`).join(', ');
        parts.push(
            `Policy ${policy.policyId} (${policy.product}) measures delay from ${policy.delayMeasure}` +
                (exclusions ? `; exclusions flagged: ${exclusions}.` : '; no exclusions flagged.'),
        );
    }
    const leg = flight?.leg;
    if (leg) {
        const measure = policy?.delayMeasure ?? 'departure';
        const delay = computeDelay(leg, measure);
        const [scheduled, actual, timeZone] =
            measure === 'departure'
                ? [leg.scheduledDeparture, leg.actualDeparture, leg.origin.timeZone]
                : [leg.scheduledArrival, leg.actualArrival, leg.destination.timeZone];
        const actualText = actual ? `actual ${local(actual, timeZone).time}` : 'no actual time recorded';
        const delayText = delay.minutes !== null ? ` (${Math.max(0, delay.minutes)} minutes late)` : '';
        parts.push(
            `Flight ${leg.flightNumber} ${leg.origin.iata} → ${leg.destination.iata}: scheduled ${measure} ` +
                `${local(scheduled, timeZone).time}, ${actualText}${delayText}.`,
        );
    } else if (flight) {
        parts.push(`No record found for flight ${facts.flightNumber} on ${facts.flightDate}.`);
    }
    if (weather) {
        const airports = (checks: { airport: string }[]) => checks.map((check) => check.airport).join(' and ');
        parts.push(
            weather.severe
                ? `Severe weather recorded at ${airports(weather.checks.filter((check) => check.severe))}.`
                : `No severe weather at ${airports(weather.checks)}.`,
        );
    }
    return parts.join(' ');
}
