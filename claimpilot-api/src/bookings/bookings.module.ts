import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Booking, BookingSchema } from './booking.schema';
import { BookingsRepository } from './bookings.repository';
import { BookingsSeeder } from './bookings.seeder';

@Module({
    imports: [MongooseModule.forFeature([{ name: Booking.name, schema: BookingSchema }])],
    providers: [BookingsRepository, BookingsSeeder],
    exports: [BookingsRepository],
})
export class BookingsModule {}
