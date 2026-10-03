import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Claim } from '../claims/claim.schema';
import type { ClaimOutcome, ClaimReview } from '../claims/claims.constants';
import { ClaimsRepository } from '../claims/claims.repository';
import type { Page } from '../mongo/mongo.repository';
import { PoliciesRepository } from '../policies/policies.repository';
import type { PayoutTier } from '../policies/policy.schema';
import { RequestContext } from '../request-context/request-context';
import { TraceService } from '../trace/trace.service';
import type { ReviewDecisionDto } from './review-decision.dto';

/** One referred claim as the reviewer sees it in the queue. */
export interface ReviewItem {
    claimId: string;
    customerId: string;
    policyId: string;
    flightNumber: string | null;
    flightDate: string | null;
    /** Why the system referred it. */
    referralReasons: string[];
    integrityFlags: string[];
    evidencedDelayMinutes?: number;
    /** The tier the recorded delay reaches, i.e. what approval would pay by default. */
    qualifyingPayout: { amount: number; currency: string } | null;
    /** Amounts a reviewer may approve. */
    payoutOptions: { amount: number; currency: string; minDelayMinutes: number }[];
    review: ClaimReview;
    createdAt: string;
}

/**
 * Human review of REFERred claims: the queue, and recording a reviewer's decision. The triage outcome is
 * never overwritten; the review records the final say, its reason and when it was made.
 */
@Injectable()
export class ReviewsService {
    constructor(
        private readonly claims: ClaimsRepository,
        private readonly policies: PoliciesRepository,
        private readonly trace: TraceService,
    ) {}

    /**
     * One page of the review queue.
     * @param status Pending (the work queue) or resolved (history).
     * @param page 1-based page.
     * @param limit Page size.
     */
    async list(status: 'pending' | 'resolved', page: number, limit: number): Promise<Page<ReviewItem>> {
        const result = await this.claims.findForReview(status, page, limit);
        const items = await Promise.all(result.items.map((claim) => this.toItem(claim)));
        return { ...result, items };
    }

    /**
     * Records a reviewer's decision on a pending referral.
     * @param claimId Claim id.
     * @param dto Decision, note and optional payout amount.
     * @throws NotFoundException when the claim doesn't exist.
     * @throws ConflictException when the claim isn't awaiting review (never referred, or already decided).
     * @throws BadRequestException when the payout isn't one of the policy's tiers.
     */
    async decide(claimId: string, dto: ReviewDecisionDto): Promise<ReviewItem> {
        const claim = await this.claims.findById(claimId);
        if (!claim) throw new NotFoundException('Claim not found');
        if (claim.review?.status !== 'pending') throw new ConflictException('This claim is not awaiting review');

        const tiers = (await this.policies.findByPolicyId(claim.policyId))?.payoutTiers ?? [];
        const review: ClaimReview = {
            status: 'resolved',
            decision: dto.decision,
            note: dto.note,
            decidedAt: new Date(),
            requestId: RequestContext.requestId(),
            ...(dto.decision === 'APPROVE' && { payout: this.payoutFor(dto, claim.outcome, tiers) }),
        };

        const updated = await this.claims.resolvePendingReview(claimId, { $set: { review } });
        if (!updated) throw new ConflictException('This claim was decided by someone else');

        const payout = review.payout
            ? ` ${review.payout.currency} ${review.payout.amount.toLocaleString('en-IN')}`
            : '';
        await this.trace.append(claimId, 'reviewer', 'review.decided', `Reviewer decided ${dto.decision}${payout}`, {
            data: { review },
        });
        return this.toItem(updated);
    }

    /**
     * The approved payout: the reviewer's chosen tier, or the tier the recorded delay reaches.
     * @param dto Reviewer's decision.
     * @param outcome Triage outcome (has the recorded delay).
     * @param tiers Policy payout tiers.
     * @throws BadRequestException when the amount isn't a tier, or no tier applies and none was chosen.
     */
    private payoutFor(dto: ReviewDecisionDto, outcome: ClaimOutcome | undefined, tiers: PayoutTier[]) {
        const chosen = dto.payoutAmount ?? qualifyingTier(tiers, outcome?.evidencedDelayMinutes)?.amount;
        const tier = tiers.find((t) => t.amount === chosen);
        if (!tier) {
            const options = tiers.map((t) => t.amount).join(', ');
            throw new BadRequestException(
                chosen === undefined
                    ? `No tier applies to the recorded delay; choose a payoutAmount (${options}).`
                    : `payoutAmount must be one of the policy's tiers (${options}).`,
            );
        }
        return { amount: tier.amount, currency: tier.currency };
    }

    /**
     * Builds the queue view of a claim.
     * @param claim Referred claim.
     */
    private async toItem(claim: Claim): Promise<ReviewItem> {
        const tiers = (await this.policies.findByPolicyId(claim.policyId))?.payoutTiers ?? [];
        const qualifying = qualifyingTier(tiers, claim.outcome?.evidencedDelayMinutes);
        return {
            claimId: String(claim._id),
            customerId: claim.customerId,
            policyId: claim.policyId,
            flightNumber: claim.facts?.flightNumber ?? null,
            flightDate: claim.facts?.flightDate ?? null,
            referralReasons: claim.outcome?.reasons ?? [],
            integrityFlags: claim.evidence?.integrity?.flags.map((flag) => flag.code) ?? [],
            evidencedDelayMinutes: claim.outcome?.evidencedDelayMinutes,
            qualifyingPayout: qualifying ? { amount: qualifying.amount, currency: qualifying.currency } : null,
            payoutOptions: tiers,
            review: claim.review as ClaimReview,
            createdAt: claim.createdAt.toISOString(),
        };
    }
}

/**
 * Highest tier a delay reaches.
 * @param tiers Policy payout tiers.
 * @param minutes Recorded delay; undefined when unknown.
 */
function qualifyingTier(tiers: PayoutTier[], minutes: number | undefined): PayoutTier | undefined {
    if (minutes === undefined) return undefined;
    return [...tiers].sort((a, b) => b.minDelayMinutes - a.minDelayMinutes).find((t) => minutes >= t.minDelayMinutes);
}
