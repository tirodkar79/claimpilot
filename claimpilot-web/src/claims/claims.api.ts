import { httpClient } from '../api/http-client';
import type { Page } from '../api/page';

/** Mirrors the API's ClaimView, ClaimFacts, ClaimOutcome and PolicyFindings (claimpilot-api/src). */
export type ClaimStatus = 'triaging' | 'completed';
export type ClaimDecision = 'APPROVE' | 'REJECT' | 'REFER' | 'NEED_INFO';

export interface ClaimFacts {
    flightNumber: string | null;
    flightDate: string | null;
    origin: string | null;
    destination: string | null;
    claimedDelayMinutes: number | null;
    claimedCause: string | null;
}

export interface ClauseCitation {
    clauseId: string;
    title: string;
}

export interface ClaimOutcome {
    decision: ClaimDecision;
    reasons: string[];
    citations: ClauseCitation[];
    payout?: { amount: number; currency: string; minDelayMinutes: number };
    /** Delay from the flight record, measured the way the policy defines it. */
    evidencedDelayMinutes?: number;
}

export interface FlightLeg {
    flightNumber: string;
    status: 'scheduled' | 'departed' | 'landed' | 'cancelled' | 'diverted' | 'unknown';
    origin: { iata: string; timeZone: string };
    destination: { iata: string; timeZone: string };
    scheduledDeparture: string;
    scheduledArrival: string;
    actualDeparture?: string;
    actualArrival?: string;
}

/** Flight agent result after the API checked its choice (claimpilot-api/src/agents/flight.agent.ts). */
export interface FlightFindings {
    flightNumber: string;
    claimedDate: string;
    leg?: FlightLeg;
    source?: 'recorded' | 'aerodatabox';
    selectedBy?: 'agent' | 'code';
    notes: string;
    lookups: { date: string; legs: number }[];
}

export interface WeatherObservation {
    time: string;
    weatherCode: number | null;
    condition: string;
    gustKmh: number | null;
    precipitationMm: number | null;
    severe: boolean;
}

/** Weather agent result (claimpilot-api/src/agents/weather.agent.ts); severity is computed by code. */
export interface WeatherFindings {
    source: 'open-meteo-mcp';
    severe: boolean;
    checks: {
        airport: string;
        role: 'departure' | 'arrival';
        windowStart: string;
        windowEnd: string;
        severe: boolean;
        severeObservations: WeatherObservation[];
        observationCount: number;
    }[];
    notes: string;
    guardFetched: string[];
}

/** Integrity checks (claimpilot-api/src/integrity/integrity.service.ts). Plain code, no model. */
export interface IntegrityFindings {
    flags: { code: string; detail: string; clauseId?: string }[];
    checked: {
        duplicates: number;
        booking: 'matched' | 'not_given' | 'problem';
        purchase: 'before_departure' | 'after_departure' | 'not_checked';
    };
}

export interface PolicyClause {
    id: string;
    title: string;
    text: string;
}

/** Policy agent result after the API checked its citations (claimpilot-api/src/agents/policy.agent.ts). */
export interface PolicyFindings {
    policyId: string;
    delayMeasure: 'departure' | 'arrival';
    relevantExclusions: { type: string; clauseId: string; summary: string }[];
    summary: string;
    citedClauses: PolicyClause[];
    droppedCitations: string[];
    /** Weather/strike exclusions flagged that the claimed cause doesn't support (absent on older claims). */
    droppedExclusions?: { type: string; clauseId: string }[];
    delayMeasureMismatch: boolean;
}

export interface ClaimReview {
    status: 'pending' | 'resolved';
    decision?: 'APPROVE' | 'REJECT' | 'NEED_INFO';
    payout?: { amount: number; currency: string };
    note?: string;
    decidedAt?: string;
}

/** Safety checks around the model: injection signals in the claim text and grounding of the summary. */
export interface ClaimSafety {
    injectionSuspected: boolean;
    injectionSignals: string[];
    summary?: { grounded: boolean; unsupported: string[]; replaced: boolean };
}

export interface Claim {
    id: string;
    customerId: string;
    policyId: string;
    bookingRef?: string;
    message: string;
    status: ClaimStatus;
    facts?: ClaimFacts;
    outcome?: ClaimOutcome;
    evidence?: {
        policy?: PolicyFindings;
        flight?: FlightFindings;
        weather?: WeatherFindings;
        integrity?: IntegrityFindings;
    };
    /** Orchestrator's summary for the reviewer; informational only. */
    summary?: string;
    review?: ClaimReview;
    safety?: ClaimSafety;
    createdAt: string;
}

export interface CreateClaimRequest {
    customerId: string;
    policyId: string;
    bookingRef?: string;
    message: string;
}

/**
 * Submits a claim; triage starts on the server straight away.
 * @param body Claim details.
 */
export async function createClaim(body: CreateClaimRequest): Promise<Claim> {
    const { data } = await httpClient.post<Claim>('/claims', body);
    return data;
}

/** One row of the claims history. Mirrors ClaimListItem in claimpilot-api/src/claims/claims.service.ts. */
export interface ClaimListItem {
    id: string;
    customerId: string;
    policyId: string;
    flightNumber: string | null;
    flightDate: string | null;
    status: ClaimStatus;
    decision?: ClaimDecision;
    payout?: { amount: number; currency: string };
    reviewDecision?: 'APPROVE' | 'REJECT' | 'NEED_INFO';
    reviewStatus?: 'pending' | 'resolved';
    createdAt: string;
}

/**
 * Claims history, newest first.
 * @param customerId Only this customer's claims, when given.
 * @param page 1-based page.
 */
export async function listClaims(customerId: string | undefined, page: number): Promise<Page<ClaimListItem>> {
    const { data } = await httpClient.get<Page<ClaimListItem>>('/claims', {
        params: { customerId: customerId || undefined, page, limit: CLAIMS_PAGE_SIZE },
    });
    return data;
}

export const CLAIMS_PAGE_SIZE = 25;

/**
 * Answers a NEED_INFO outcome; the claim is triaged again (follow it on the same event stream).
 * @param id Claim id.
 * @param message The missing details.
 */
export async function addClaimDetails(id: string, message: string): Promise<Claim> {
    const { data } = await httpClient.post<Claim>(`/claims/${id}/details`, { message });
    return data;
}

/**
 * Fetches a claim with its facts and outcome.
 * @param id Claim id.
 */
export async function getClaim(id: string): Promise<Claim> {
    const { data } = await httpClient.get<Claim>(`/claims/${id}`);
    return data;
}
