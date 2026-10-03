import { z } from 'zod';

/** Request body of `POST /claims`. Also feeds the Swagger docs via JSON Schema. */
export const createClaimSchema = z.object({
    customerId: z.string().trim().min(1).max(50).describe('Customer id, e.g. C-1042'),
    policyId: z.string().trim().min(1).max(50).describe('Policy id, e.g. P-77'),
    bookingRef: z.string().trim().max(20).optional().describe('Airline booking reference (PNR)'),
    message: z.string().trim().min(10).max(4000).describe('What happened, in the claimant’s own words'),
});

export type CreateClaimDto = z.infer<typeof createClaimSchema>;

/** Request body of `POST /claims/:id/details`: the claimant's answer to a NEED_INFO outcome. */
export const claimDetailsSchema = z.object({
    message: z.string().trim().min(2).max(1000).describe('The missing details, e.g. "Flight 6E-2134 on 30 September"'),
});

export type ClaimDetailsDto = z.infer<typeof claimDetailsSchema>;
