import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { POLICY_SEEDS } from './policies.seed';
import { PoliciesRepository } from './policies.repository';

/** Loads the fictional demo policies on startup. Idempotent: existing policies are replaced. */
@Injectable()
export class PoliciesSeeder implements OnApplicationBootstrap {
    private readonly logger = new Logger(PoliciesSeeder.name);

    constructor(private readonly policies: PoliciesRepository) {}

    /** Upserts every seed policy. */
    async onApplicationBootstrap(): Promise<void> {
        await Promise.all(POLICY_SEEDS.map((policy) => this.policies.upsert(policy)));
        this.logger.log(`Seeded ${POLICY_SEEDS.length} policies`);
    }
}
