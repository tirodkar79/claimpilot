import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { BOOKING_SEEDS } from './bookings.seed';
import { BookingsRepository } from './bookings.repository';

/** Loads the fictional demo bookings on startup. Idempotent: existing bookings are replaced. */
@Injectable()
export class BookingsSeeder implements OnApplicationBootstrap {
    private readonly logger = new Logger(BookingsSeeder.name);

    constructor(private readonly bookings: BookingsRepository) {}

    /** Upserts every seed booking. */
    async onApplicationBootstrap(): Promise<void> {
        await Promise.all(BOOKING_SEEDS.map((booking) => this.bookings.upsert(booking)));
        this.logger.log(`Seeded ${BOOKING_SEEDS.length} bookings`);
    }
}
