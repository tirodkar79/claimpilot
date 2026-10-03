import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { TRACE_ACTORS, TRACE_EVENT_TYPES, type TraceActor, type TraceEventType } from './trace.constants';

/** One step of a claim's triage: the audit log, the live-view feed and the input to evals. */
@Schema({ collection: 'trace_events', versionKey: false })
export class TraceEvent {
    _id: Types.ObjectId;

    @Prop({ type: Types.ObjectId, required: true })
    claimId: Types.ObjectId;

    /** Order within the claim, starting at 1. */
    @Prop({ required: true })
    seq: number;

    @Prop({ type: String, required: true, enum: TRACE_ACTORS })
    actor: TraceActor;

    @Prop({ type: String, required: true, enum: TRACE_EVENT_TYPES })
    type: TraceEventType;

    @Prop({ required: true })
    message: string;

    @Prop({ type: Object })
    data?: Record<string, unknown>;

    @Prop()
    durationMs?: number;

    @Prop({ required: true, default: () => new Date() })
    at: Date;
}

export const TraceEventSchema = SchemaFactory.createForClass(TraceEvent);
TraceEventSchema.index({ claimId: 1, seq: 1 }, { unique: true });
