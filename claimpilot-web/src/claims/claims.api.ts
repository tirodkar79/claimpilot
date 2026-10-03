import { httpClient } from '../api/http-client';

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
    delayMeasureMismatch: boolean;
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
    evidence?: { policy?: PolicyFindings; flight?: FlightFindings };
    /** Orchestrator's summary for the reviewer; informational only. */
    summary?: string;
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

/**
 * Fetches a claim with its facts and outcome.
 * @param id Claim id.
 */
export async function getClaim(id: string): Promise<Claim> {
    const { data } = await httpClient.get<Claim>(`/claims/${id}`);
    return data;
}
