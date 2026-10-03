import { z } from 'zod';
import { REVIEW_DECISIONS } from '../claims/claims.constants';

/** Body of `POST /reviews/:claimId/decision`. */
export const reviewDecisionSchema = z
    .object({
        decision: z.enum(REVIEW_DECISIONS).describe('Final decision on the referred claim'),
        note: z.string().trim().min(5).max(1000).describe('Why: required so every human decision is explained'),
        payoutAmount: z
            .number()
            .positive()
            .optional()
            .describe('APPROVE only: one of the policy tier amounts. Defaults to the tier the recorded delay reaches'),
    })
    .refine((body) => body.decision === 'APPROVE' || body.payoutAmount === undefined, {
        message: 'payoutAmount is only allowed when approving',
        path: ['payoutAmount'],
    });

export type ReviewDecisionDto = z.infer<typeof reviewDecisionSchema>;
