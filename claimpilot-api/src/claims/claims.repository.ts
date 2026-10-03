import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MongoRepository } from '../mongo/mongo.repository';
import { Claim } from './claim.schema';

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
}
