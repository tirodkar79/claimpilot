import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MongoRepository } from '../mongo/mongo.repository';
import { Policy } from './policy.schema';

@Injectable()
export class PoliciesRepository extends MongoRepository<Policy> {
    constructor(@InjectModel(Policy.name) model: Model<Policy>) {
        super(model);
    }

    /**
     * Finds a policy by its business id (e.g. "P-77").
     * @param policyId Policy id.
     */
    findByPolicyId(policyId: string): Promise<Policy | null> {
        return this.findOne({ policyId });
    }

    /**
     * Inserts or replaces a policy by its business id.
     * @param policy Policy to store.
     */
    async upsert(policy: Omit<Policy, '_id'>): Promise<void> {
        await this.model.replaceOne({ policyId: policy.policyId }, policy, { upsert: true }).exec();
    }
}
