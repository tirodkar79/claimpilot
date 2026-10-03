import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MongoRepository } from '../mongo/mongo.repository';
import { EVAL_CONNECTION } from './evals.constants';
import { EvalRun } from './eval-run.schema';

export type EvalRunSummary = Omit<EvalRun, 'cases'>;

@Injectable()
export class EvalRunsRepository extends MongoRepository<EvalRun> {
    constructor(@InjectModel(EvalRun.name, EVAL_CONNECTION) model: Model<EvalRun>) {
        super(model);
    }

    /**
     * Most recent runs without their per-case detail, newest first.
     * @param limit How many runs.
     */
    findRecentSummaries(limit: number): Promise<EvalRunSummary[]> {
        return this.model
            .find()
            .sort({ startedAt: -1 })
            .limit(limit)
            .select({ cases: 0 })
            .lean<EvalRunSummary[]>()
            .exec();
    }
}
