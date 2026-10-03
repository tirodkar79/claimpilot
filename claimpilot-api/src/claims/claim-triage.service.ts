import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FlightAgent, type FlightFindings } from '../agents/flight.agent';
import { IntakeAgent } from '../agents/intake.agent';
import { OrchestratorAgent, type OrchestratorDelegates } from '../agents/orchestrator.agent';
import { PolicyAgent, type PolicyFindings } from '../agents/policy.agent';
import { WeatherAgent, type WeatherFindings } from '../agents/weather.agent';
import { localDate, localDateTime } from '../common/utils/local-date';
import { EnvConfig } from '../config/env.validation';
import { computeDelay } from '../flights/flight-delay';
import { IntegrityService, type IntegrityFindings } from '../integrity/integrity.service';
import { PoliciesRepository } from '../policies/policies.repository';
import { scanForInjection } from '../safety/injection-detector';
import { checkGrounding } from '../safety/summary-grounding';
import type { Policy } from '../policies/policy.schema';
import type { TraceActor } from '../trace/trace.constants';
import { TraceService, type TraceRecorder } from '../trace/trace.service';
import { adjudicate } from './adjudicate';
import { findMissingInformation, normaliseFacts, type ClaimFacts } from './claim-facts';
import { evidenceSummary, groundingAllowList } from './claim-summary';
import type { Claim } from './claim.schema';
import type { ClaimOutcome, ClaimSafety, FailureTarget } from './claims.constants';
import { ClaimsRepository } from './claims.repository';

const INTAKE_FAILED_REASON = 'We could not read the claim automatically, so a person will review it.';
const INTEGRITY_FAILED_REASON = 'We could not run the integrity checks, so a person will review it.';
type SubAgent = Extract<TraceActor, 'policy' | 'flight' | 'weather'>;

const AGENT_FAILED_REASON: Record<SubAgent, string> = {
    policy: 'We could not check the policy automatically, so a person will review it.',
    flight: 'We could not check the flight record automatically, so a person will review it.',
    weather: 'We could not check the weather records automatically, so a person will review it.',
};

/**
 * One sub-agent's result within a run. The in-flight promise is shared, so concurrent delegations (the
 * orchestrator calling the same agent twice in one step) run the agent once.
 */
interface Delegation<T> {
    pending?: Promise<T | undefined>;
    result?: T;
    failed: boolean;
}

/** Everything one run needs to share between the orchestrator's delegations and the guard. */
interface RunContext {
    claim: Claim;
    facts: ClaimFacts;
    policy: Policy | null;
    recorder: TraceRecorder;
    policyEvidence: Delegation<PolicyFindings>;
    flightEvidence: Delegation<FlightFindings>;
    weatherEvidence: Delegation<WeatherFindings>;
}

/**
 * Runs a claim's triage and records every step in the trace.
 *
 * Intake (code-invoked, quarantined) → completeness check → LLM orchestrator, which delegates to the
 * Policy and Flight agents, and to the Weather agent only when a weather exclusion could change the outcome →
 * guard (runs required agents the orchestrator skipped, blocks unneeded ones) → integrity checks (code) →
 * rules engine decides.
 * Model output never decides the outcome; failures end in REFER rather than a guess.
 */
@Injectable()
export class ClaimTriageService {
    private readonly logger = new Logger(ClaimTriageService.name);
    private readonly timeZone: string;

    constructor(
        config: ConfigService<EnvConfig, true>,
        private readonly claims: ClaimsRepository,
        private readonly policies: PoliciesRepository,
        private readonly intake: IntakeAgent,
        private readonly orchestrator: OrchestratorAgent,
        private readonly policyAgent: PolicyAgent,
        private readonly flightAgent: FlightAgent,
        private readonly weatherAgent: WeatherAgent,
        private readonly integrity: IntegrityService,
        private readonly trace: TraceService,
    ) {
        this.timeZone = config.get('CLAIMANT_TIMEZONE', { infer: true });
    }

    /**
     * Runs triage for a stored claim. Never throws: failures are traced and become REFER.
     * @param claim Claim to triage.
     * @param today Today's date in the claimant's time zone (YYYY-MM-DD); injectable for tests.
     * @returns The outcome that was stored.
     */
    async run(claim: Claim, today = localDate(new Date(), this.timeZone)): Promise<ClaimOutcome> {
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
                : await this.assess(claim, facts, recorder);
        }

        await recorder.record('orchestrator', 'decision', outcome.decision, { data: { outcome } });
        await this.claims.updateById(claimId, {
            outcome,
            status: 'completed',
            ...(outcome.decision === 'REFER' && { review: { status: 'pending' } }),
        });
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
            this.failIfInjected(claim, 'intake');
            const facts = normaliseFacts(await this.intake.extract(claim.message, today));
            await recorder.record('intake', 'agent.completed', 'Facts extracted', {
                data: { facts },
                durationMs: Date.now() - startedAt,
            });
            await this.claims.updateById(String(claim._id), { facts, safety: await this.scanMessage(claim, recorder) });
            return facts;
        } catch (error) {
            this.logError('Intake', claim, error);
            await recorder.record('intake', 'agent.failed', 'Intake agent failed', failureData(error));
            return null;
        }
    }

    /**
     * Lets the orchestrator delegate, enforces the required agents, then applies the rules engine.
     * @param claim Claim being triaged.
     * @param facts Complete facts.
     * @param recorder Trace recorder.
     */
    private async assess(claim: Claim, facts: ClaimFacts, recorder: TraceRecorder): Promise<ClaimOutcome> {
        const run: RunContext = {
            claim,
            facts,
            policy: await this.policies.findByPolicyId(claim.policyId),
            recorder,
            policyEvidence: { failed: false },
            flightEvidence: { failed: false },
            weatherEvidence: { failed: false },
        };
        const delegates: OrchestratorDelegates = {
            consultPolicy: (focus) => this.consultPolicy(run, focus),
            consultFlight: (focus) => this.consultFlight(run, focus),
            consultWeather: (focus) => this.consultWeather(run, focus),
        };

        await recorder.record('orchestrator', 'agent.started', 'Planning which agents to consult');
        const startedAt = Date.now();
        let summary: string | undefined;
        try {
            this.failIfInjected(claim, 'orchestrator');
            summary = await this.orchestrator.run(facts, delegates, recorder);
            await recorder.record('orchestrator', 'agent.completed', 'Orchestrator finished', {
                data: { summary },
                durationMs: Date.now() - startedAt,
            });
        } catch (error) {
            this.logError('Orchestrator', claim, error);
            await recorder.record(
                'orchestrator',
                'agent.failed',
                'Orchestrator failed; running required checks',
                failureData(error),
            );
        }

        // Guard: required agents run even if the orchestrator skipped them or failed.
        if (run.policy && !run.policyEvidence.result && !run.policyEvidence.failed) {
            await recorder.record('orchestrator', 'guard.enforced', 'Policy agent was not consulted; running it');
            await delegates.consultPolicy('Required policy check');
        }
        if (run.policy && !run.flightEvidence.result && !run.flightEvidence.failed) {
            await recorder.record('orchestrator', 'guard.enforced', 'Flight agent was not consulted; running it');
            await delegates.consultFlight('Required flight check');
        }
        if (this.weatherNeeded(run) && !run.weatherEvidence.result && !run.weatherEvidence.failed) {
            await recorder.record(
                'orchestrator',
                'guard.enforced',
                'Weather exclusion flagged but weather not checked; running it',
            );
            await delegates.consultWeather('Required weather check');
        }

        const integrity = await this.checkIntegrity(run);
        const grounded = await this.groundSummary(run, summary);
        await this.claims.updateById(String(claim._id), {
            evidence: {
                policy: run.policyEvidence.result,
                flight: run.flightEvidence.result,
                weather: run.weatherEvidence.result,
                integrity: integrity ?? undefined,
            },
            summary: grounded.summary,
            'safety.summary': grounded.check,
        });
        const evidence = { policy: run.policyEvidence, flight: run.flightEvidence, weather: run.weatherEvidence };
        for (const agent of ['policy', 'flight', 'weather'] as const) {
            if (evidence[agent].failed)
                return { decision: 'REFER', reasons: [AGENT_FAILED_REASON[agent]], citations: [] };
        }
        if (integrity === null) return { decision: 'REFER', reasons: [INTEGRITY_FAILED_REASON], citations: [] };
        return adjudicate({
            facts,
            policy: run.policy,
            policyId: claim.policyId,
            customerId: claim.customerId,
            submittedOn: localDate(claim.createdAt, this.timeZone),
            policyFindings: run.policyEvidence.result,
            flight: run.flightEvidence.result,
            weather: run.weatherEvidence.result,
            integrity,
        });
    }

    /**
     * Integrity checks (plain code), run for every claim with a policy so no approval skips them.
     * @param run Current run.
     * @returns Findings; undefined when there is no policy; null when the checks themselves failed.
     */
    private async checkIntegrity(run: RunContext): Promise<IntegrityFindings | undefined | null> {
        if (!run.policy) return undefined;
        try {
            this.failIfInjected(run.claim, 'integrity');
            return await this.integrity.check(
                run.claim,
                run.facts,
                run.policy,
                run.flightEvidence.result?.leg,
                run.recorder,
            );
        } catch (error) {
            this.logError('Integrity checks', run.claim, error);
            return null;
        }
    }

    /**
     * Whether the weather check can change the outcome: the policy flagged a severe-weather exclusion and the
     * recorded delay reaches a payout tier (otherwise the claim is decided without it).
     * @param run Current run.
     */
    private weatherNeeded(run: RunContext): boolean {
        const { policy } = run;
        const leg = run.flightEvidence.result?.leg;
        const weatherExcluded = run.policyEvidence.result?.relevantExclusions.some((e) => e.type === 'severe_weather');
        if (!policy || !leg || !weatherExcluded) return false;
        const minutes = computeDelay(leg, policy.delayMeasure).minutes;
        return minutes !== null && policy.payoutTiers.some((tier) => minutes >= tier.minDelayMinutes);
    }

    /**
     * Delegation target: the Weather agent. Waits for the policy and flight evidence it depends on, and
     * refuses (without spending a model call) when the check can't change the outcome.
     * @param run Current run.
     * @param focus What the orchestrator asked for.
     */
    private async consultWeather(run: RunContext, focus: string): Promise<Record<string, unknown>> {
        await Promise.all([
            this.consultPolicy(run, 'Needed for the weather check'),
            this.consultFlight(run, 'Needed for the weather check'),
        ]);
        const leg = run.flightEvidence.result?.leg;
        if (!this.weatherNeeded(run) || !leg) {
            await run.recorder.record('orchestrator', 'guard.enforced', 'Weather check not needed; skipped', {
                data: { blocked: 'weather', reason: 'no weather exclusion that could change the outcome' },
            });
            return {
                skipped: true,
                reason: 'No severe-weather exclusion applies to a payable delay, so weather is irrelevant.',
            };
        }
        const findings = await this.runOnce('weather', run.weatherEvidence, run, focus, () =>
            this.weatherAgent.check(leg, run.recorder),
        );
        if (!findings) return { error: 'The Weather agent is unavailable.' };
        return {
            severe: findings.severe,
            checks: findings.checks.map((check) => ({
                airport: check.airport,
                role: check.role,
                severe: check.severe,
                conditions: [...new Set(check.severeObservations.map((o) => o.condition))],
            })),
            notes: findings.notes,
        };
    }

    /**
     * Delegation target: the Policy agent. Returns a compact briefing, not the full clause text.
     * @param run Current run.
     * @param focus What the orchestrator asked for.
     */
    private async consultPolicy(run: RunContext, focus: string): Promise<Record<string, unknown>> {
        const { policy } = run;
        if (!policy) return { found: false, message: `No policy ${run.claim.policyId} exists.` };

        const findings = await this.runOnce('policy', run.policyEvidence, run, focus, () =>
            this.policyAgent.assess(policy, run.facts, run.recorder),
        );
        if (!findings) return { error: 'The Policy agent is unavailable.' };
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
     * Delegation target: the Flight evidence agent. Returns what was found, without computing payouts.
     * @param run Current run.
     * @param focus What the orchestrator asked for.
     */
    private async consultFlight(run: RunContext, focus: string): Promise<Record<string, unknown>> {
        // Without a policy the outcome is NEED_INFO regardless, so don't spend a model call or a lookup.
        if (!run.policy) return { skipped: true, message: `No policy ${run.claim.policyId} exists to check against.` };
        const findings = await this.runOnce('flight', run.flightEvidence, run, focus, () =>
            this.flightAgent.investigate(run.facts, run.recorder),
        );
        if (!findings) return { error: 'The Flight agent is unavailable.' };
        if (!findings.leg) return { found: false, notes: findings.notes };
        // Local times with the zone: raw UTC timestamps led the orchestrator to quote UTC as local time.
        const { leg } = findings;
        const at = (iso: string | undefined, timeZone: string) => (iso ? localDateTime(iso, timeZone) : null);
        return {
            found: true,
            status: leg.status,
            route: `${leg.origin.iata} → ${leg.destination.iata}`,
            scheduledDeparture: at(leg.scheduledDeparture, leg.origin.timeZone),
            actualDeparture: at(leg.actualDeparture, leg.origin.timeZone),
            scheduledArrival: at(leg.scheduledArrival, leg.destination.timeZone),
            actualArrival: at(leg.actualArrival, leg.destination.timeZone),
        };
    }

    /**
     * Runs a sub-agent at most once per claim, tracing start, end or failure. Repeat or concurrent delegations
     * share the same run; after a failure, later calls get undefined without retrying.
     * @param agent Sub-agent name.
     * @param delegation Its slot in the run context (mutated).
     * @param run Current run.
     * @param focus What the orchestrator asked for.
     * @param work Runs the sub-agent.
     */
    private async runOnce<T>(
        agent: SubAgent,
        delegation: Delegation<T>,
        run: RunContext,
        focus: string,
        work: () => Promise<T>,
    ): Promise<T | undefined> {
        delegation.pending ??= (async () => {
            await run.recorder.record(agent, 'agent.started', `${agent} agent started`, { data: { focus } });
            const startedAt = Date.now();
            try {
                this.failIfInjected(run.claim, agent);
                delegation.result = await work();
                await run.recorder.record(agent, 'agent.completed', `${agent} agent finished`, {
                    data: { findings: delegation.result },
                    durationMs: Date.now() - startedAt,
                });
            } catch (error) {
                this.logError(agent, run.claim, error);
                delegation.failed = true;
                await run.recorder.record(agent, 'agent.failed', `${agent} agent failed`, failureData(error));
            }
            return delegation.result;
        })();
        return delegation.pending;
    }

    /**
     * Scans the raw claim text for prompt-injection signals and traces any found. The text was already
     * fenced as data for Intake, so this is for visibility, not protection.
     * @param claim Claim being triaged.
     * @param recorder Trace recorder.
     */
    private async scanMessage(claim: Claim, recorder: TraceRecorder): Promise<ClaimSafety> {
        const scan = scanForInjection(claim.message);
        if (scan.suspected) {
            await recorder.record(
                'intake',
                'checks.completed',
                `Possible prompt injection (${scan.signals.join(', ')}); treated as data`,
                {
                    data: { signals: scan.signals },
                },
            );
        }
        return { injectionSuspected: scan.suspected, injectionSignals: scan.signals };
    }

    /**
     * Keeps the orchestrator's summary only if every specific fact in it is in the evidence; otherwise (or if
     * there is none) stores a summary built from the evidence, and traces why.
     * @param run Current run.
     * @param summary Orchestrator's summary, if it produced one.
     */
    private async groundSummary(run: RunContext, summary: string | undefined) {
        const evidence = {
            facts: run.facts,
            policy: run.policy,
            policyFindings: run.policyEvidence.result,
            flight: run.flightEvidence.result,
            weather: run.weatherEvidence.result,
        };
        if (!summary) {
            return { summary: evidenceSummary(evidence), check: { grounded: true, unsupported: [], replaced: true } };
        }
        const result = checkGrounding(summary, groundingAllowList(evidence));
        if (result.grounded) return { summary, check: { ...result, replaced: false } };

        await run.recorder.record(
            'orchestrator',
            'guard.enforced',
            `Summary stated ${result.unsupported.join(', ')} not found in the evidence; replaced with an evidence-based summary`,
            { data: { rejectedSummary: summary, unsupported: result.unsupported } },
        );
        return { summary: evidenceSummary(evidence), check: { ...result, replaced: true } };
    }

    /**
     * Throws when the claim asked for this step to fail (demo and eval use).
     * @param claim Claim being triaged.
     * @param target Step about to run.
     */
    private failIfInjected(claim: Claim, target: FailureTarget): void {
        if (claim.injectFailures?.includes(target)) throw new Error(`Injected failure: ${target}`);
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

/**
 * Trace data for a failure: the first line of the error, enough to tell an outage from a bad answer.
 * @param error What was thrown.
 */
function failureData(error: unknown): { data: { error: string } } {
    const message = error instanceof Error ? error.message : String(error);
    return { data: { error: message.split('\n')[0].slice(0, 200) } };
}
