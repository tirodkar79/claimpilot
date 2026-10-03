import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { ClaimFacts } from './claim-facts';
import { CLAIM_STATUSES, type ClaimOutcome, type ClaimStatus } from './claims.constants';

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

    createdAt: Date;
    updatedAt: Date;
}

export const ClaimSchema = SchemaFactory.createForClass(Claim);
