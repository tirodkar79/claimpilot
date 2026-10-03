import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

export const DELAY_MEASURES = ['departure', 'arrival'] as const;
export type DelayMeasure = (typeof DELAY_MEASURES)[number];

export interface PayoutTier {
    minDelayMinutes: number;
    amount: number;
    currency: string;
}

export interface PolicyClause {
    /** Stable clause number cited in decisions, e.g. "4.1". */
    id: string;
    title: string;
    text: string;
}

/** Clause numbers the rules engine cites for each check. */
export interface PolicyClauseRefs {
    coveragePeriod: string;
    claimDeadline: string;
    delayMeasure: string;
    payoutTiers: string;
}

/**
 * A travel policy: the structured schedule (dates, limits, tiers) that the rules engine uses, plus the
 * wording (clauses) that the Policy agent reads for exclusions and how delay is measured.
 */
@Schema({ collection: 'policies', versionKey: false })
export class Policy {
    _id: Types.ObjectId;

    @Prop({ required: true, unique: true })
    policyId: string;

    @Prop({ required: true })
    product: string;

    @Prop({ required: true })
    holderCustomerId: string;

    /** First and last covered day (YYYY-MM-DD, inclusive). */
    @Prop({ required: true })
    coverageStart: string;

    @Prop({ required: true })
    coverageEnd: string;

    @Prop({ required: true })
    purchasedAt: Date;

    /** Claims must be submitted within this many days of the flight. */
    @Prop({ required: true })
    claimDeadlineDays: number;

    @Prop({ type: String, required: true, enum: DELAY_MEASURES })
    delayMeasure: DelayMeasure;

    @Prop({ type: [Object], required: true })
    payoutTiers: PayoutTier[];

    @Prop({ type: Object, required: true })
    clauseRefs: PolicyClauseRefs;

    @Prop({ type: [Object], required: true })
    clauses: PolicyClause[];
}

export const PolicySchema = SchemaFactory.createForClass(Policy);
