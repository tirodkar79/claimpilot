import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ClaimFacts } from './claim-facts';
import type { Claim } from './claim.schema';
import { ClaimTriageService } from './claim-triage.service';
import type { ClaimOutcome, ClaimStatus } from './claims.constants';
import { ClaimsRepository } from './claims.repository';
import type { CreateClaimDto } from './create-claim.dto';

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
    createdAt: string;
}

@Injectable()
export class ClaimsService {
    private readonly logger = new Logger(ClaimsService.name);

    constructor(
        private readonly claims: ClaimsRepository,
        private readonly triage: ClaimTriageService,
    ) {}

    /**
     * Stores a claim and starts triage in the background; progress is followed via the event stream.
     * @param dto Validated request body.
     * @returns The new claim.
     */
    async create(dto: CreateClaimDto): Promise<ClaimView> {
        const claim = await this.claims.create({ ...dto, status: 'triaging' });
        this.triage.run(claim).catch((error: unknown) => {
            this.logger.error(`Triage crashed for claim ${String(claim._id)}`, error);
        });
        return toView(claim);
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
        createdAt: claim.createdAt.toISOString(),
    };
}
