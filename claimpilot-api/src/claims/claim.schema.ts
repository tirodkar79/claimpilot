import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { FlightFindings } from '../agents/flight.agent';
import type { PolicyFindings } from '../agents/policy.agent';
import type { WeatherFindings } from '../agents/weather.agent';
import type { IntegrityFindings } from '../integrity/integrity.service';
import type { ClaimFacts } from './claim-facts';
import {
    CLAIM_STATUSES,
    type ClaimOutcome,
    type ClaimReview,
    type ClaimSafety,
    type ClaimStatus,
    type FailureTarget,
} from './claims.constants';

export interface ClaimEvidence {
    policy?: PolicyFindings;
    flight?: FlightFindings;
    weather?: WeatherFindings;
    integrity?: IntegrityFindings;
}

@Schema({ collection: 'claims', timestamps: true, versionKey: false })
export class Claim {
    _id: Types.ObjectId;

    @Prop({ required: true })
    customerId: string;

    @Prop({ required: true })
    policyId: string;

    @Prop()
    bookingRef?: string;

    /** Raw claimant text. Only the Intake agent ever reads it. */
    @Prop({ required: true })
    message: string;

    @Prop({ type: String, required: true, enum: CLAIM_STATUSES, default: 'triaging' })
    status: ClaimStatus;

    @Prop({ type: Object })
    facts?: ClaimFacts;

    @Prop({ type: Object })
    outcome?: ClaimOutcome;

    /** What each sub-agent found, after code validation. */
    @Prop({ type: Object })
    evidence?: ClaimEvidence;

    /** Orchestrator's summary for the reviewer. Informational only; never used to decide. */
    @Prop()
    summary?: string;

    @Prop({ type: Object })
    safety?: ClaimSafety;

    /** Steps forced to fail for this claim (demo and eval use only). */
    @Prop({ type: [String] })
    injectFailures?: FailureTarget[];

    /** Present once the claim is referred: pending until a reviewer decides. */
    @Prop({ type: Object })
    review?: ClaimReview;

    createdAt: Date;
    updatedAt: Date;
}

export const ClaimSchema = SchemaFactory.createForClass(Claim);
