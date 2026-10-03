import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MongoRepository } from '../mongo/mongo.repository';
import { Booking } from './booking.schema';

@Injectable()
export class BookingsRepository extends MongoRepository<Booking> {
    constructor(@InjectModel(Booking.name) model: Model<Booking>) {
        super(model);
    }

    /**
     * Finds a booking by its reference (case-insensitive input, stored upper-case).
     * @param bookingRef Booking reference (PNR).
     */
    findByRef(bookingRef: string): Promise<Booking | null> {
        return this.findOne({ bookingRef: bookingRef.trim().toUpperCase() });
    }

    /**
     * Inserts or replaces a booking by its reference.
     * @param booking Booking to store.
     */
    async upsert(booking: Omit<Booking, '_id'>): Promise<void> {
        await this.model.replaceOne({ bookingRef: booking.bookingRef }, booking, { upsert: true }).exec();
    }
}
