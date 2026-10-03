import { Injectable, Logger } from '@nestjs/common';
import { IntakeAgent } from '../agents/intake.agent';
import { OrchestratorAgent } from '../agents/orchestrator.agent';
import { PolicyAgent, type PolicyFindings } from '../agents/policy.agent';
import { PoliciesRepository } from '../policies/policies.repository';
import type { Policy } from '../policies/policy.schema';
import type { TraceRecorder } from '../trace/trace.service';
import { TraceService } from '../trace/trace.service';
import { adjudicate } from './adjudicate';
import { findMissingInformation, normaliseFacts, type ClaimFacts } from './claim-facts';
import type { Claim } from './claim.schema';
import type { ClaimOutcome } from './claims.constants';
import { ClaimsRepository } from './claims.repository';

const INTAKE_FAILED_REASON = 'We could not read the claim automatically, so a person will review it.';
const POLICY_FAILED_REASON = 'We could not check the policy automatically, so a person will review it.';

/** Evidence gathered during one run. Filled by delegations; read by the rules engine. */
interface RunEvidence {
    policy?: PolicyFindings;
    policyFailed: boolean;
}

/**
 * Runs a claim's triage and records every step in the trace.
 *
 * Intake (code-invoked, quarantined) → completeness check → LLM orchestrator, which delegates to the
 * Policy agent → guard (runs required checks the orchestrator skipped) → rules engine decides.
 * Model output never decides the outcome; failures end in REFER rather than a guess.
 */
@Injectable()
export class ClaimTriageService {
    private readonly logger = new Logger(ClaimTriageService.name);

    constructor(
        private readonly claims: ClaimsRepository,
        private readonly policies: PoliciesRepository,
        private readonly intake: IntakeAgent,
        private readonly orchestrator: OrchestratorAgent,
        private readonly policyAgent: PolicyAgent,
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

        const facts = await this.extractFacts(claim, today, recorder);
        let outcome: ClaimOutcome;
        if (!facts) {
            outcome = { decision: 'REFER', reasons: [INTAKE_FAILED_REASON], citations: [] };
        } else {
            const missing = findMissingInformation(facts, today);
            outcome = missing.length
                ? { decision: 'NEED_INFO', reasons: missing.map((item) => item.question), citations: [] }
                : await this.assessCoverage(claim, facts, recorder);
        }

        await recorder.record('orchestrator', 'decision', outcome.decision, { data: { outcome } });
        await this.claims.updateById(claimId, { outcome, status: 'completed' });
        await recorder.record('orchestrator', 'triage.completed', 'Triage completed');
        return outcome;
    }

    /**
     * Runs the Intake agent and stores the normalised facts.
     * @param claim Claim being triaged.
     * @param today Today's date.
     * @param recorder Trace recorder.
     * @returns Facts, or null when Intake failed.
     */
    private async extractFacts(claim: Claim, today: string, recorder: TraceRecorder): Promise<ClaimFacts | null> {
        await recorder.record('intake', 'agent.started', 'Extracting facts from the claim');
        const startedAt = Date.now();
        try {
            const facts = normaliseFacts(await this.intake.extract(claim.message, today));
            await recorder.record('intake', 'agent.completed', 'Facts extracted', {
                data: { facts },
                durationMs: Date.now() - startedAt,
            });
            await this.claims.updateById(String(claim._id), { facts });
            return facts;
        } catch (error) {
            this.logError('Intake', claim, error);
            await recorder.record('intake', 'agent.failed', 'Intake agent failed');
            return null;
        }
    }

    /**
     * Lets the orchestrator delegate, enforces required checks, then applies the rules engine.
     * @param claim Claim being triaged.
     * @param facts Complete facts.
     * @param recorder Trace recorder.
     */
    private async assessCoverage(claim: Claim, facts: ClaimFacts, recorder: TraceRecorder): Promise<ClaimOutcome> {
        const policy = await this.policies.findByPolicyId(claim.policyId);
        const evidence: RunEvidence = { policyFailed: false };
        const consultPolicy = (focus: string) => this.consultPolicy(claim, policy, facts, evidence, recorder, focus);

        await recorder.record('orchestrator', 'agent.started', 'Planning which agents to consult');
        const startedAt = Date.now();
        let summary: string | undefined;
        try {
            summary = await this.orchestrator.run(facts, { consultPolicy }, recorder);
            await recorder.record('orchestrator', 'agent.completed', 'Orchestrator finished', {
                data: { summary },
                durationMs: Date.now() - startedAt,
            });
        } catch (error) {
            this.logError('Orchestrator', claim, error);
            await recorder.record('orchestrator', 'agent.failed', 'Orchestrator failed; running required checks');
        }

        if (policy && !evidence.policy && !evidence.policyFailed) {
            await recorder.record('orchestrator', 'guard.enforced', 'Policy agent was not consulted; running it');
            await consultPolicy('Required policy check');
        }

        await this.claims.updateById(String(claim._id), { evidence: { policy: evidence.policy }, summary });
        if (evidence.policyFailed) {
            return { decision: 'REFER', reasons: [POLICY_FAILED_REASON], citations: [] };
        }
        return adjudicate({
            facts,
            policy,
            policyId: claim.policyId,
            customerId: claim.customerId,
            submittedOn: claim.createdAt.toISOString().slice(0, 10),
        });
    }

    /**
     * Delegation target for the orchestrator. Runs the Policy agent once per claim; repeat calls get
     * the same findings. Returns a compact briefing, not the full clause text.
     * @param claim Claim being triaged.
     * @param policy Policy, or null when the id doesn't exist.
     * @param facts Claim facts.
     * @param evidence Evidence of this run (mutated).
     * @param recorder Trace recorder.
     * @param focus What the orchestrator asked for.
     */
    private async consultPolicy(
        claim: Claim,
        policy: Policy | null,
        facts: ClaimFacts,
        evidence: RunEvidence,
        recorder: TraceRecorder,
        focus: string,
    ): Promise<Record<string, unknown>> {
        if (!policy) return { found: false, message: `No policy ${claim.policyId} exists.` };
        if (evidence.policyFailed) return { error: 'The Policy agent is unavailable.' };

        if (!evidence.policy) {
            await recorder.record('policy', 'agent.started', `Reading policy ${policy.policyId}`, { data: { focus } });
            const startedAt = Date.now();
            try {
                evidence.policy = await this.policyAgent.assess(policy, facts, recorder);
                await recorder.record('policy', 'agent.completed', 'Policy read', {
                    data: { findings: evidence.policy },
                    durationMs: Date.now() - startedAt,
                });
            } catch (error) {
                this.logError('Policy', claim, error);
                evidence.policyFailed = true;
                await recorder.record('policy', 'agent.failed', 'Policy agent failed');
                return { error: 'The Policy agent is unavailable.' };
            }
        }

        const findings = evidence.policy;
        return {
            found: true,
            product: policy.product,
            coverageStart: policy.coverageStart,
            coverageEnd: policy.coverageEnd,
            delayMeasure: findings.delayMeasure,
            relevantExclusions: findings.relevantExclusions,
            summary: findings.summary,
        };
    }

    /**
     * Logs an agent failure with its stack.
     * @param agent Agent name.
     * @param claim Claim being triaged.
     * @param error Thrown value.
     */
    private logError(agent: string, claim: Claim, error: unknown): void {
        this.logger.error(
            `${agent} failed for claim ${String(claim._id)}`,
            error instanceof Error ? error.stack : error,
        );
    }
}
