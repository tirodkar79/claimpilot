import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PoliciesRepository } from './policies.repository';
import { PoliciesSeeder } from './policies.seeder';
import { Policy, PolicySchema } from './policy.schema';

@Module({
    imports: [MongooseModule.forFeature([{ name: Policy.name, schema: PolicySchema }])],
    providers: [PoliciesRepository, PoliciesSeeder],
    exports: [PoliciesRepository],
})
export class PoliciesModule {}
