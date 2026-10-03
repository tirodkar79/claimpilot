import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BookingsModule } from '../bookings/bookings.module';
import { Claim, ClaimSchema } from '../claims/claim.schema';
import { ClaimsRepository } from '../claims/claims.repository';
import { IntegrityService } from './integrity.service';

@Module({
    imports: [MongooseModule.forFeature([{ name: Claim.name, schema: ClaimSchema }]), BookingsModule],
    providers: [ClaimsRepository, IntegrityService],
    exports: [IntegrityService],
})
export class IntegrityModule {}
