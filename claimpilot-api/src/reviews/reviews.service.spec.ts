import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { Claim } from '../claims/claim.schema';
import type { ClaimsRepository } from '../claims/claims.repository';
import type { PoliciesRepository } from '../policies/policies.repository';
import { POLICY_SEEDS } from '../policies/policies.seed';
import type { TraceService } from '../trace/trace.service';
import { ReviewsService } from './reviews.service';

const referred = {
    _id: new Types.ObjectId(),
    customerId: 'C-3001',
    policyId: 'P-77', // tiers 2h ₹2,000 · 4h ₹5,000 · 6h ₹10,000
    facts: { flightNumber: '6E2134', flightDate: '2026-09-30' },
    outcome: {
        decision: 'REFER',
        reasons: ['Integrity checks raised questions.'],
        citations: [],
        evidencedDelayMinutes: 230,
    },
    evidence: { integrity: { flags: [{ code: 'late_purchase', detail: 'x' }] } },
    review: { status: 'pending' },
    createdAt: new Date('2026-10-01T10:00:00Z'),
} as unknown as Claim;

/**
 * Builds the service over a stubbed claims store.
 * @param claim Claim returned by findById.
 * @param resolves Whether the conditional update succeeds.
 */
function setup(claim: Claim | null = referred, resolves = true) {
    const append = jest.fn().mockResolvedValue({});
    const resolvePendingReview = jest.fn(async (_id: string, update: { $set: { review: unknown } }) =>
        resolves ? { ...claim, review: update.$set.review } : null,
    );
    const service = new ReviewsService(
        {
            findById: async () => claim,
            resolvePendingReview,
            findForReview: async () => ({ items: claim ? [claim] : [], total: 1, page: 1, limit: 20 }),
        } as unknown as ClaimsRepository,
        {
            findByPolicyId: async (id: string) => POLICY_SEEDS.find((p) => p.policyId === id) ?? null,
        } as unknown as PoliciesRepository,
        { append } as unknown as TraceService,
    );
    return { service, append, resolvePendingReview };
}

describe('ReviewsService', () => {
    it('lists a referral with what approval would pay and the allowed amounts', async () => {
        const { items } = await setup().service.list('pending', 1, 20);
        expect(items[0]).toMatchObject({
            claimId: String(referred._id),
            integrityFlags: ['late_purchase'],
            evidencedDelayMinutes: 230,
            qualifyingPayout: { amount: 2000, currency: 'INR' },
            payoutOptions: [{ amount: 2000 }, { amount: 5000 }, { amount: 10000 }],
        });
    });

    it('approves at the tier the recorded delay reaches by default and traces the decision', async () => {
        const { service, append } = setup();
        const item = await service.decide(String(referred._id), {
            decision: 'APPROVE',
            note: 'Purchase was a renewal.',
        });

        expect(item.review).toMatchObject({
            status: 'resolved',
            decision: 'APPROVE',
            payout: { amount: 2000, currency: 'INR' },
        });
        expect(append).toHaveBeenCalledWith(
            String(referred._id),
            'reviewer',
            'review.decided',
            'Reviewer decided APPROVE INR 2,000',
            expect.anything(),
        );
    });

    it('lets the reviewer pick another tier, but only a real one', async () => {
        const { service } = setup();
        const item = await service.decide(String(referred._id), {
            decision: 'APPROVE',
            note: 'Arrival was later.',
            payoutAmount: 5000,
        });
        expect(item.review.payout?.amount).toBe(5000);

        await expect(
            setup().service.decide(String(referred._id), {
                decision: 'APPROVE',
                note: 'Generous.',
                payoutAmount: 7500,
            }),
        ).rejects.toThrow(BadRequestException);
    });

    it('requires a chosen tier when the recorded delay reaches none', async () => {
        const noDelay = { ...referred, outcome: { ...referred.outcome!, evidencedDelayMinutes: undefined } } as Claim;
        await expect(
            setup(noDelay).service.decide(String(referred._id), { decision: 'APPROVE', note: 'Cancelled.' }),
        ).rejects.toThrow('choose a payoutAmount');
    });

    it('records a rejection without a payout', async () => {
        const item = await setup().service.decide(String(referred._id), {
            decision: 'REJECT',
            note: 'Bought after the delay.',
        });
        expect(item.review).toMatchObject({ decision: 'REJECT' });
        expect(item.review.payout).toBeUndefined();
    });

    it.each([
        ['an unknown claim', null, NotFoundException],
        ['a claim that was never referred', { ...referred, review: undefined } as Claim, ConflictException],
        ['an already decided claim', { ...referred, review: { status: 'resolved' } } as Claim, ConflictException],
    ])('refuses %s', async (_label, claim, error) => {
        await expect(
            setup(claim as Claim | null).service.decide('x', { decision: 'REJECT', note: 'n/a here' }),
        ).rejects.toThrow(error);
    });

    it('refuses when another reviewer decided first', async () => {
        await expect(
            setup(referred, false).service.decide(String(referred._id), { decision: 'REJECT', note: 'Too late.' }),
        ).rejects.toThrow('decided by someone else');
    });
});
