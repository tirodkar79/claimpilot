import { Injectable, Logger } from '@nestjs/common';
import { IntakeAgent } from '../agents/intake.agent';
import { TraceService } from '../trace/trace.service';
import { findMissingInformation, normaliseFacts } from './claim-facts';
import type { Claim } from './claim.schema';
import type { ClaimOutcome } from './claims.constants';
import { ClaimsRepository } from './claims.repository';

const EVIDENCE_PENDING_REASON = 'Claim details are complete. Evidence checks are not connected yet.';
const INTAKE_FAILED_REASON = 'We could not read the claim automatically, so a person will review it.';

/**
 * Orchestrates a claim's triage and records every step in the trace.
 * Current flow: Intake → completeness check → NEED_INFO or PENDING. Evidence agents plug in here
 * in later phases; any failure ends in REFER so nothing is decided on partial information.
 */
@Injectable()
export class ClaimTriageService {
    private readonly logger = new Logger(ClaimTriageService.name);

    constructor(
        private readonly claims: ClaimsRepository,
        private readonly intake: IntakeAgent,
        private readonly trace: TraceService,
    ) {}

    /**
     * Runs triage for a stored claim. Never throws: failures are traced and become REFER.
     * @param claim Claim to triage.
     * @param today Today's date (YYYY-MM-DD); injectable for tests.
     * @returns The outcome that was stored.
     */
    async run(claim: Claim, today = new Date().toISOString().slice(0, 10)): Promise<ClaimOutcome> {
        const claimId = String(claim._id);
        const recorder = this.trace.forClaim(claimId);
        await recorder.record('orchestrator', 'triage.started', 'Triage started');

        let outcome: ClaimOutcome;
        try {
            await recorder.record('intake', 'agent.started', 'Extracting facts from the claim');
            const startedAt = Date.now();
            const facts = normaliseFacts(await this.intake.extract(claim.message, today));
            await recorder.record('intake', 'agent.completed', 'Facts extracted', {
                data: { facts },
                durationMs: Date.now() - startedAt,
            });
            await this.claims.updateById(claimId, { facts });

            const missing = findMissingInformation(facts, today);
            outcome = missing.length
                ? { decision: 'NEED_INFO', reasons: missing.map((item) => item.question) }
                : { decision: 'PENDING', reasons: [EVIDENCE_PENDING_REASON] };
        } catch (error) {
            this.logger.error(`Intake failed for claim ${claimId}`, error instanceof Error ? error.stack : error);
            await recorder.record('intake', 'agent.failed', 'Intake agent failed');
            outcome = { decision: 'REFER', reasons: [INTAKE_FAILED_REASON] };
        }

        await recorder.record('orchestrator', 'decision', outcome.decision, { data: { outcome } });
        await this.claims.updateById(claimId, { outcome, status: 'completed' });
        await recorder.record('orchestrator', 'triage.completed', 'Triage completed');
        return outcome;
    }
}
