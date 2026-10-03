import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

/**
 * An airline booking (PNR): which flight it is for and who travelled on it. Demo bookings are not tied to a
 * date, matching the recorded flights, which apply to any date.
 */
@Schema({ collection: 'bookings', versionKey: false })
export class Booking {
    _id: Types.ObjectId;

    @Prop({ required: true, unique: true })
    bookingRef: string;

    /** Normalised flight number, e.g. "6E2134". */
    @Prop({ required: true })
    flightNumber: string;

    /** Customer ids of the passengers on the booking. */
    @Prop({ type: [String], required: true })
    passengerCustomerIds: string[];
}

export const BookingSchema = SchemaFactory.createForClass(Booking);
