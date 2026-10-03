import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Page } from '../mongo/mongo.repository';
import { TraceService } from '../trace/trace.service';
import type { ClaimFacts } from './claim-facts';
import type { Claim, ClaimEvidence } from './claim.schema';
import { ClaimTriageService } from './claim-triage.service';
import type {
    ClaimDecision,
    ClaimOutcome,
    ClaimReview,
    ClaimSafety,
    ClaimStatus,
    FailureTarget,
} from './claims.constants';
import { ClaimsRepository } from './claims.repository';
import type { ClaimDetailsDto, CreateClaimDto } from './create-claim.dto';

/** Claim as exposed by the API. */
export interface ClaimView {
    id: string;
    customerId: string;
    policyId: string;
    bookingRef?: string;
    message: string;
    status: ClaimStatus;
    facts?: ClaimFacts;
    outcome?: ClaimOutcome;
    evidence?: ClaimEvidence;
    summary?: string;
    review?: ClaimReview;
    safety?: ClaimSafety;
    createdAt: string;
}

/** One row of the claims history. */
export interface ClaimListItem {
    id: string;
    customerId: string;
    policyId: string;
    flightNumber: string | null;
    flightDate: string | null;
    status: ClaimStatus;
    /** Triage outcome; undefined while triaging. */
    decision?: ClaimDecision;
    payout?: { amount: number; currency: string };
    /** The reviewer's decision, once a referral has been decided. */
    reviewDecision?: ClaimReview['decision'];
    reviewStatus?: ClaimReview['status'];
    createdAt: string;
}

@Injectable()
export class ClaimsService {
    private readonly logger = new Logger(ClaimsService.name);

    constructor(
        private readonly claims: ClaimsRepository,
        private readonly triage: ClaimTriageService,
        private readonly trace: TraceService,
    ) {}

    /**
     * Stores a claim and starts triage in the background; progress is followed via the event stream.
     * @param dto Validated request body.
     * @param injectFailures Steps to force to fail (demo and eval use; already authorised by the controller).
     * @returns The new claim.
     */
    async create(dto: CreateClaimDto, injectFailures: FailureTarget[] = []): Promise<ClaimView> {
        const claim = await this.claims.create({ ...dto, status: 'triaging', injectFailures });
        this.startTriage(claim);
        return toView(claim);
    }

    /**
     * Adds the claimant's answer to a claim that is waiting for more information, and triages it again.
     * The earlier outcome and evidence are cleared; the trace keeps both runs.
     * @param id Claim id.
     * @param dto The missing details.
     * @throws NotFoundException when the claim doesn't exist.
     * @throws ConflictException when the claim isn't waiting for information.
     */
    async addDetails(id: string, dto: ClaimDetailsDto): Promise<ClaimView> {
        const existing = await this.claims.findById(id);
        if (!existing) throw new NotFoundException('Claim not found');
        if (existing.status !== 'completed' || existing.outcome?.decision !== 'NEED_INFO') {
            throw new ConflictException('Only a claim that is waiting for more information can take more details');
        }

        const claim = await this.claims.updateById(id, {
            $set: { message: `${existing.message}\n\nAdditional details: ${dto.message}`, status: 'triaging' },
            $unset: { outcome: 1, facts: 1, evidence: 1, summary: 1, safety: 1 },
        });
        await this.trace.append(id, 'claimant', 'details.added', 'Claimant added the missing details', {
            data: { details: dto.message },
        });
        this.startTriage(claim!);
        return toView(claim!);
    }

    /**
     * Runs triage in the background; it never throws, but a crash is logged.
     * @param claim Stored claim.
     */
    private startTriage(claim: Claim): void {
        this.triage.run(claim).catch((error: unknown) => {
            this.logger.error(`Triage crashed for claim ${String(claim._id)}`, error);
        });
    }

    /**
     * Claims history, newest first.
     * @param customerId Only this customer's claims, when given.
     * @param page 1-based page.
     * @param limit Page size (max 100).
     */
    async list(customerId: string | undefined, page: number, limit: number): Promise<Page<ClaimListItem>> {
        const result = await this.claims.findHistory(customerId, page, limit);
        return { ...result, items: result.items.map(toListItem) };
    }

    /**
     * Fetches one claim.
     * @param id Claim id.
     * @throws NotFoundException when the claim doesn't exist or the id is malformed.
     */
    async get(id: string): Promise<ClaimView> {
        const claim = await this.claims.findById(id);
        if (!claim) throw new NotFoundException('Claim not found');
        return toView(claim);
    }
}

/**
 * Maps a stored claim to its API shape.
 * @param claim Stored claim.
 */
function toView(claim: Claim): ClaimView {
    return {
        id: String(claim._id),
        customerId: claim.customerId,
        policyId: claim.policyId,
        bookingRef: claim.bookingRef,
        message: claim.message,
        status: claim.status,
        facts: claim.facts,
        outcome: claim.outcome,
        evidence: claim.evidence,
        summary: claim.summary,
        review: claim.review,
        safety: claim.safety,
        createdAt: claim.createdAt.toISOString(),
    };
}

/**
 * Maps a stored claim to a history row.
 * @param claim Stored claim.
 */
function toListItem(claim: Claim): ClaimListItem {
    const payout = claim.review?.payout ?? claim.outcome?.payout;
    return {
        id: String(claim._id),
        customerId: claim.customerId,
        policyId: claim.policyId,
        flightNumber: claim.facts?.flightNumber ?? null,
        flightDate: claim.facts?.flightDate ?? null,
        status: claim.status,
        decision: claim.outcome?.decision,
        ...(payout && { payout: { amount: payout.amount, currency: payout.currency } }),
        reviewDecision: claim.review?.decision,
        reviewStatus: claim.review?.status,
        createdAt: claim.createdAt.toISOString(),
    };
}
