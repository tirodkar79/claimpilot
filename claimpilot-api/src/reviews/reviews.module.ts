import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Claim, ClaimSchema } from '../claims/claim.schema';
import { ClaimsRepository } from '../claims/claims.repository';
import { PoliciesModule } from '../policies/policies.module';
import { TraceModule } from '../trace/trace.module';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({
    imports: [MongooseModule.forFeature([{ name: Claim.name, schema: ClaimSchema }]), PoliciesModule, TraceModule],
    controllers: [ReviewsController],
    providers: [ClaimsRepository, ReviewsService],
})
export class ReviewsModule {}
