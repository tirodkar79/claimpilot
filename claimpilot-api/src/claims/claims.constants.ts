export const CLAIM_STATUSES = ['triaging', 'completed'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/**
 * Outcomes available so far. APPROVE and REJECT arrive with the evidence agents; until then a
 * complete claim is PENDING, and any failure is REFERred to a human rather than guessed.
 */
export const CLAIM_DECISIONS = ['NEED_INFO', 'PENDING', 'REFER'] as const;
export type ClaimDecision = (typeof CLAIM_DECISIONS)[number];

export interface ClaimOutcome {
    decision: ClaimDecision;
    /** Why, in plain language. For NEED_INFO these are the questions for the claimant. */
    reasons: string[];
}
