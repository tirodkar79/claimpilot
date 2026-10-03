import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, UpdateQuery } from 'mongoose';
import { MongoRepository, type Page } from '../mongo/mongo.repository';
import { Claim } from './claim.schema';
import type { ReviewStatus } from './claims.constants';

@Injectable()
export class ClaimsRepository extends MongoRepository<Claim> {
    constructor(@InjectModel(Claim.name) model: Model<Claim>) {
        super(model);
    }

    /**
     * The customer's other claims for the same flight and date, newest first.
     * @param customerId Customer id.
     * @param flightNumber Normalised flight number.
     * @param flightDate Flight date (YYYY-MM-DD).
     * @param excludeId The claim being triaged.
     */
    findOtherClaimsForFlight(
        customerId: string,
        flightNumber: string,
        flightDate: string,
        excludeId: string,
    ): Promise<Claim[]> {
        return this.find({
            customerId,
            'facts.flightNumber': flightNumber,
            'facts.flightDate': flightDate,
            _id: { $ne: new Types.ObjectId(excludeId) },
        });
    }

    /**
     * Claims newest first, optionally for one customer.
     * @param customerId Only this customer's claims, when given.
     * @param page 1-based page.
     * @param limit Page size.
     */
    findHistory(customerId: string | undefined, page: number, limit: number): Promise<Page<Claim>> {
        return this.paginate({ filter: customerId ? { customerId } : {}, page, limit, sort: { createdAt: -1 } });
    }

    /**
     * Claims in the review queue: pending oldest first (fairest order), resolved newest first.
     * @param status Review status.
     * @param page 1-based page.
     * @param limit Page size.
     */
    findForReview(status: ReviewStatus, page: number, limit: number): Promise<Page<Claim>> {
        return this.paginate({
            filter: { 'review.status': status },
            page,
            limit,
            sort: status === 'pending' ? { createdAt: 1 } : { 'review.decidedAt': -1 },
        });
    }

    /**
     * Applies an update only while the claim's review is still pending, so two reviewers can't both decide.
     * @param id Claim id.
     * @param update Update to apply.
     * @returns The updated claim, or null if it doesn't exist or is no longer pending.
     */
    resolvePendingReview(id: string, update: UpdateQuery<Claim>): Promise<Claim | null> {
        return this.model
            .findOneAndUpdate({ _id: new Types.ObjectId(id), 'review.status': 'pending' }, update, {
                returnDocument: 'after',
            })
            .lean<Claim>()
            .exec();
    }
}
