import type { IntakeExtraction } from '../agents/intake.agent';

/** Claim facts after normalisation. Values the claimant gave but that are malformed become null. */
export interface ClaimFacts {
    flightNumber: string | null;
    flightDate: string | null;
    origin: string | null;
    destination: string | null;
    claimedDelayMinutes: number | null;
    claimedCause: string | null;
}

export interface MissingInformation {
    field: keyof ClaimFacts;
    question: string;
}

/** Airline designator (2 characters) + 1–4 digit number + optional suffix, e.g. 6E2134. */
const FLIGHT_NUMBER = /^[A-Z0-9]{2}\d{1,4}[A-Z]?$/;
const IATA_AIRPORT = /^[A-Z]{3}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DELAY_MINUTES = 72 * 60;

/**
 * Normalises what the Intake agent extracted: upper-cases codes, strips separators from the flight
 * number, and drops values that are malformed or implausible rather than passing them on.
 * @param extraction Raw output of the Intake agent.
 */
export function normaliseFacts(extraction: IntakeExtraction): ClaimFacts {
    const flightNumber = extraction.flightNumber?.toUpperCase().replace(/[\s-]/g, '') ?? null;
    const delay = extraction.claimedDelayMinutes;

    return {
        flightNumber: flightNumber && FLIGHT_NUMBER.test(flightNumber) ? flightNumber : null,
        flightDate: isValidIsoDate(extraction.flightDate) ? extraction.flightDate : null,
        origin: airportCode(extraction.origin),
        destination: airportCode(extraction.destination),
        claimedDelayMinutes: delay !== null && delay > 0 && delay <= MAX_DELAY_MINUTES ? Math.round(delay) : null,
        claimedCause: extraction.claimedCause?.trim() || null,
    };
}

/**
 * Lists what must be asked before the claim can be assessed: flight number, a past flight date
 * and the claimed delay. Route and cause are optional; flight data and policy rules supply them.
 * @param facts Normalised facts.
 * @param today Today's date (YYYY-MM-DD).
 */
export function findMissingInformation(facts: ClaimFacts, today: string): MissingInformation[] {
    const missing: MissingInformation[] = [];
    if (!facts.flightNumber) {
        missing.push({ field: 'flightNumber', question: 'What is your flight number (for example 6E-2134)?' });
    }
    if (!facts.flightDate) {
        missing.push({ field: 'flightDate', question: 'On what date was your flight?' });
    } else if (facts.flightDate > today) {
        missing.push({
            field: 'flightDate',
            question: `The flight date ${facts.flightDate} is in the future. On what date was the delayed flight?`,
        });
    }
    if (!facts.claimedDelayMinutes) {
        missing.push({ field: 'claimedDelayMinutes', question: 'Roughly how long was your flight delayed?' });
    }
    return missing;
}

/**
 * True for a real calendar date in YYYY-MM-DD form (rejects e.g. 2026-02-30).
 * @param value Candidate date string.
 */
function isValidIsoDate(value: string | null): value is string {
    if (!value || !ISO_DATE.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/**
 * Upper-cases and validates an IATA airport code.
 * @param value Candidate code.
 */
function airportCode(value: string | null): string | null {
    const code = value?.trim().toUpperCase();
    return code && IATA_AIRPORT.test(code) ? code : null;
}
