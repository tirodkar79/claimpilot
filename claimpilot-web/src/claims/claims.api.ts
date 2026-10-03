import { httpClient } from '../api/http-client';

/** Mirrors the API's ClaimView, ClaimFacts and ClaimOutcome (claimpilot-api/src/claims). */
export type ClaimStatus = 'triaging' | 'completed';
export type ClaimDecision = 'NEED_INFO' | 'PENDING' | 'REFER';

export interface ClaimFacts {
    flightNumber: string | null;
    flightDate: string | null;
    origin: string | null;
    destination: string | null;
    claimedDelayMinutes: number | null;
    claimedCause: string | null;
}

export interface ClaimOutcome {
    decision: ClaimDecision;
    reasons: string[];
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
