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
}
