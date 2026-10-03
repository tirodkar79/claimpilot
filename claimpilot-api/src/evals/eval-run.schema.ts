import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { EvalCaseResult, EvalMetrics, EvalRegression } from './evals.constants';

/** One run of the eval suite: settings, headline metrics, comparison with the baseline and every attempt. */
@Schema({ collection: 'eval_runs', versionKey: false })
export class EvalRun {
    _id: Types.ObjectId;

    @Prop({ required: true })
    startedAt: Date;

    @Prop({ required: true })
    finishedAt: Date;

    /** `provider:modelId` the agents ran on. */
    @Prop({ required: true })
    model: string;

    /** Attempts per case. */
    @Prop({ required: true })
    repeats: number;

    @Prop({ required: true })
    judged: boolean;

    @Prop({ type: Object, required: true })
    metrics: EvalMetrics;

    /** Empty when there was no baseline to compare with or nothing regressed. */
    @Prop({ type: [Object], default: [] })
    regressions: EvalRegression[];

    @Prop({ required: true })
    comparedWithBaseline: boolean;

    @Prop({ type: [Object], default: [] })
    cases: EvalCaseResult[];
}

export const EvalRunSchema = SchemaFactory.createForClass(EvalRun);
EvalRunSchema.index({ startedAt: -1 });
