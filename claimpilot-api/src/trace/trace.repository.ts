import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MongoRepository } from '../mongo/mongo.repository';
import { TraceEvent } from './trace-event.schema';

@Injectable()
export class TraceRepository extends MongoRepository<TraceEvent> {
    constructor(@InjectModel(TraceEvent.name) model: Model<TraceEvent>) {
        super(model);
    }

    /**
     * All events of a claim in order.
     * @param claimId Claim id.
     */
    findByClaim(claimId: string): Promise<TraceEvent[]> {
        return this.find({ claimId: new Types.ObjectId(claimId) }, { seq: 1 });
    }

    /**
     * Highest sequence number recorded for a claim, or 0 when it has no events.
     * @param claimId Claim id.
     */
    async lastSeq(claimId: string): Promise<number> {
        const [last] = await this.model
            .find({ claimId: new Types.ObjectId(claimId) })
            .sort({ seq: -1 })
            .limit(1)
            .lean()
            .exec();
        return last?.seq ?? 0;
    }
}
