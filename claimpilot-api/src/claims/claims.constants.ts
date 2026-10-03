export const CLAIM_STATUSES = ['triaging', 'completed'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** Possible outcomes. Anything uncertain, and any failure, is REFERred to a human rather than guessed. */
export const CLAIM_DECISIONS = ['APPROVE', 'REJECT', 'REFER', 'NEED_INFO'] as const;
export type ClaimDecision = (typeof CLAIM_DECISIONS)[number];

export interface ClauseCitation {
    clauseId: string;
    title: string;
}

export interface ClaimOutcome {
    decision: ClaimDecision;
    /** Why, in plain language. For NEED_INFO these are the questions for the claimant. */
    reasons: string[];
    /** Policy clauses the decision relies on. */
    citations: ClauseCitation[];
    /** Present on APPROVE: the tier the recorded delay reaches. */
    payout?: { amount: number; currency: string; minDelayMinutes: number };
    /** Delay from the flight record, measured the way the policy defines it. */
    evidencedDelayMinutes?: number;
}

export const REVIEW_STATUSES = ['pending', 'resolved'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** What a reviewer can decide on a referred claim. */
export const REVIEW_DECISIONS = ['APPROVE', 'REJECT', 'NEED_INFO'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/** Human review of a REFERred claim. The triage outcome is kept as it was; this records the final say. */
export interface ClaimReview {
    status: ReviewStatus;
    decision?: ReviewDecision;
    payout?: { amount: number; currency: string };
    /** Why the reviewer decided this; required, so every override is explained. */
    note?: string;
    decidedAt?: Date;
    /** Request id of the decision, linking it to the API logs. */
    requestId?: string;
}
