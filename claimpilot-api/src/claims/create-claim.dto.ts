import { z } from 'zod';

/** Request body of `POST /claims`. Also feeds the Swagger docs via JSON Schema. */
export const createClaimSchema = z.object({
    customerId: z.string().trim().min(1).max(50).describe('Customer id, e.g. C-1042'),
    policyId: z.string().trim().min(1).max(50).describe('Policy id, e.g. P-77'),
    bookingRef: z.string().trim().max(20).optional().describe('Airline booking reference (PNR)'),
    message: z.string().trim().min(10).max(4000).describe('What happened, in the claimant’s own words'),
});

export type CreateClaimDto = z.infer<typeof createClaimSchema>;
