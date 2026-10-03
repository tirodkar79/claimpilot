import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MongoRepository } from '../mongo/mongo.repository';
import { Claim } from './claim.schema';

@Injectable()
export class ClaimsRepository extends MongoRepository<Claim> {
    constructor(@InjectModel(Claim.name) model: Model<Claim>) {
        super(model);
    }
}
