import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AgentsModule } from '../agents/agents.module';
import { IntegrityModule } from '../integrity/integrity.module';
import { PoliciesModule } from '../policies/policies.module';
import { TraceModule } from '../trace/trace.module';
import { Claim, ClaimSchema } from './claim.schema';
import { ClaimTriageService } from './claim-triage.service';
import { ClaimsController } from './claims.controller';
import { ClaimsRepository } from './claims.repository';
import { ClaimsService } from './claims.service';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: Claim.name, schema: ClaimSchema }]),
        AgentsModule,
        PoliciesModule,
        IntegrityModule,
        TraceModule,
    ],
    controllers: [ClaimsController],
    providers: [ClaimsRepository, ClaimsService, ClaimTriageService],
})
export class ClaimsModule {}
