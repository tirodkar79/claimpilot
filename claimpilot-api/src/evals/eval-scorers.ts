import type { Claim } from '../claims/claim.schema';
import type { TraceEvent } from '../trace/trace-event.schema';
import { SUB_AGENTS, TOOL_CALL_LIMITS, type EvalCase, type EvalCheck } from './evals.constants';

type TraceStep = Pick<TraceEvent, 'actor' | 'type' | 'data'>;

/**
 * Guard interventions in a trajectory: each one is a step the model should have taken itself. Summary
 * replacements are graded under grounding instead.
 * @param events Claim trace.
 */
export function countGuardInterventions(events: TraceStep[]): number {
    return events.filter((event) => event.type === 'guard.enforced' && !event.data?.unsupported).length;
}

/**
 * Checks the outcome against the expected decision, payout tier and cited clauses.
 * @param expected Case expectations.
 * @param claim Triaged claim.
 */
function decisionChecks(expected: EvalCase['expect'], claim: Claim): EvalCheck[] {
    const outcome = claim.outcome;
    const checks: EvalCheck[] = [
        {
            dimension: 'decision',
            name: 'decision',
            pass: outcome?.decision === expected.decision,
            detail: `expected ${expected.decision}, got ${outcome?.decision ?? 'none'}`,
        },
    ];
    if (expected.payoutAmount !== undefined) {
        checks.push({
            dimension: 'decision',
            name: 'payout',
            pass: outcome?.payout?.amount === expected.payoutAmount,
            detail: `expected ${expected.payoutAmount}, got ${outcome?.payout?.amount ?? 'none'}`,
        });
    }
    for (const clauseId of expected.citations ?? []) {
        checks.push({
            dimension: 'decision',
            name: `cites §${clauseId}`,
            pass: !!outcome?.citations.some((citation) => citation.clauseId === clauseId),
        });
    }
    return checks;
}

/**
 * Checks the facts Intake extracted.
 * @param expected Case expectations.
 * @param claim Triaged claim.
 */
function extractionChecks(expected: EvalCase['expect'], claim: Claim): EvalCheck[] {
    return Object.entries(expected.facts ?? {}).map(([field, value]) => {
        const actual = claim.facts?.[field as keyof typeof expected.facts];
        return {
            dimension: 'extraction',
            name: field,
            pass: actual === value,
            detail: `expected ${value}, got ${actual ?? 'null'}`,
        };
    });
}

/**
 * Checks who ran: the orchestrator delegated the required agents itself, unneeded agents never ran, and the
 * guard stepped in only as often as expected.
 * @param expected Case expectations.
 * @param events Claim trace.
 */
function routingChecks(expected: EvalCase['expect'], events: TraceStep[]): EvalCheck[] {
    const delegatedTo = new Set(
        events.filter((event) => event.type === 'agent.delegated').map((event) => event.data?.to as string),
    );
    const ran = new Set(events.filter((event) => event.type === 'agent.started').map((event) => event.actor));
    const guard = countGuardInterventions(events);
    const expectedGuard = expected.guardInterventions ?? 0;

    return [
        ...(expected.delegates ?? []).map((agent) => ({
            dimension: 'routing' as const,
            name: `orchestrator delegated to ${agent}`,
            pass: delegatedTo.has(agent),
        })),
        ...(expected.notRun ?? []).map((agent) => ({
            dimension: 'routing' as const,
            name: `${agent} not run`,
            pass: !ran.has(agent),
        })),
        {
            dimension: 'routing',
            name: 'guard interventions',
            pass: guard === expectedGuard,
            detail: `expected ${expectedGuard}, got ${guard}`,
        },
    ];
}

/**
 * Checks tool use per sub-agent: within the limit, and no call refused for going outside the claim.
 * @param events Claim trace.
 */
function toolChecks(events: TraceStep[]): EvalCheck[] {
    const calls = events.filter((event) => event.type === 'tool.called');
    return SUB_AGENTS.filter((agent) => calls.some((call) => call.actor === agent)).flatMap((agent) => {
        const own = calls.filter((call) => call.actor === agent);
        const refused = own.filter((call) => call.data?.refused).length;
        const used = own.length - refused;
        return [
            {
                dimension: 'tools' as const,
                name: `${agent} calls within limit`,
                pass: used <= TOOL_CALL_LIMITS[agent],
                detail: `${used} of ${TOOL_CALL_LIMITS[agent]}`,
            },
            {
                dimension: 'tools' as const,
                name: `${agent} calls in scope`,
                pass: refused === 0,
                detail: `${refused} refused`,
            },
        ];
    });
}

/**
 * Grades one triage run of a case. Pure: works on the stored claim and its trace only.
 * @param evalCase Case that was run.
 * @param claim Claim after triage.
 * @param events Its trace, in order.
 */
export function scoreAttempt(evalCase: EvalCase, claim: Claim, events: TraceStep[]): EvalCheck[] {
    const { expect: expected } = evalCase;
    const checks = [
        ...decisionChecks(expected, claim),
        ...extractionChecks(expected, claim),
        ...routingChecks(expected, events),
        ...toolChecks(events),
    ];

    const summaryCheck = claim.safety?.summary;
    const orchestratorWroteSummary = summaryCheck && !(summaryCheck.replaced && summaryCheck.grounded);
    if (summaryCheck && orchestratorWroteSummary) {
        checks.push({
            dimension: 'grounding',
            name: 'summary grounded',
            pass: summaryCheck.grounded,
            detail: summaryCheck.unsupported.join(', ') || undefined,
        });
    }
    if (expected.injectionSuspected !== undefined) {
        checks.push({
            dimension: 'safety',
            name: 'injection flagged',
            pass: claim.safety?.injectionSuspected === expected.injectionSuspected,
        });
    }
    return checks;
}
