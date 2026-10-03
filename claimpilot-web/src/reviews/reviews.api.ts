import { httpClient } from '../api/http-client';
import type { Page } from '../api/page';
import type { ClaimReview } from '../claims/claims.api';

/** Mirrors ReviewItem in claimpilot-api/src/reviews/reviews.service.ts. */
export interface ReviewItem {
    claimId: string;
    customerId: string;
    policyId: string;
    flightNumber: string | null;
    flightDate: string | null;
    referralReasons: string[];
    integrityFlags: string[];
    evidencedDelayMinutes?: number;
    qualifyingPayout: { amount: number; currency: string } | null;
    payoutOptions: { amount: number; currency: string; minDelayMinutes: number }[];
    review: ClaimReview;
    createdAt: string;
}

export interface ReviewDecision {
    decision: 'APPROVE' | 'REJECT' | 'NEED_INFO';
    note: string;
    payoutAmount?: number;
}

/**
 * The review queue (pending, oldest first) or history (resolved).
 * @param status Which list.
 */
export async function listReviews(status: 'pending' | 'resolved'): Promise<Page<ReviewItem>> {
    const { data } = await httpClient.get<Page<ReviewItem>>('/reviews', { params: { status, limit: 50 } });
    return data;
}

/**
 * Records a reviewer's decision on a referred claim.
 * @param claimId Claim id.
 * @param decision Decision, note and optional payout.
 */
export async function decideReview(claimId: string, decision: ReviewDecision): Promise<ReviewItem> {
    const { data } = await httpClient.post<ReviewItem>(`/reviews/${claimId}/decision`, decision);
    return data;
}
