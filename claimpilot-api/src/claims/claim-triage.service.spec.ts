import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import type { IntakeAgent, IntakeExtraction } from '../agents/intake.agent';
import type { OrchestratorAgent, OrchestratorDelegates } from '../agents/orchestrator.agent';
import type { PolicyAgent, PolicyFindings } from '../agents/policy.agent';
import type { PoliciesRepository } from '../policies/policies.repository';
import { POLICY_SEEDS } from '../policies/policies.seed';
import type { TraceRecorder, TraceService } from '../trace/trace.service';
import type { Claim } from './claim.schema';
import { ClaimTriageService } from './claim-triage.service';
import type { ClaimsRepository } from './claims.repository';

const complete: IntakeExtraction = {
    flightNumber: '6E-2134',
    flightDate: '2026-09-12',
    origin: 'BOM',
    destination: 'DEL',
    claimedDelayMinutes: 240,
    claimedCause: 'fog',
};

const findings: PolicyFindings = {
    policyId: 'P-77',
    delayMeasure: 'departure',
    delayMeasureMismatch: false,
    relevantExclusions: [{ type: 'severe_weather', clauseId: '7.3', summary: 'Fog is excluded.' }],
    summary: 'Fog may be excluded.',
    citedClauses: [],
    droppedCitations: [],
};

const claim = {
    _id: new Types.ObjectId(),
    customerId: 'C-1042',
    policyId: 'P-77',
    message: 'My flight 6E-2134 was delayed 4 hours',
    createdAt: new Date('2026-09-20T10:00:00Z'),
} as Claim;

type Orchestrate = (delegates: OrchestratorDelegates) => Promise<string>;

/**
 * Builds the service with stubbed agents and an in-memory trace.
 * @param overrides Agent behaviour for the test.
 */
function setup(
    overrides: {
        extract?: () => Promise<IntakeExtraction>;
        orchestrate?: Orchestrate;
        assess?: () => Promise<PolicyFindings>;
        policyId?: string;
    } = {},
) {
    const traced: string[] = [];
    const recorder: TraceRecorder = {
        record: async (actor, type) => {
            traced.push(`${actor}:${type}`);
            return {} as never;
        },
    };
    const claims = { updateById: jest.fn().mockResolvedValue(null) };
    const assess = jest.fn(overrides.assess ?? (async () => findings));
    const orchestrate: Orchestrate =
        overrides.orchestrate ??
        (async (delegates) => {
            await delegates.consultPolicy('cover and exclusions');
            return 'Policy checked.';
        });

    const service = new ClaimTriageService(
        claims as unknown as ClaimsRepository,
        {
            findByPolicyId: async (id: string) => POLICY_SEEDS.find((p) => p.policyId === id) ?? null,
        } as unknown as PoliciesRepository,
        { extract: jest.fn(overrides.extract ?? (async () => complete)) } as unknown as IntakeAgent,
        {
            run: (_facts: unknown, delegates: OrchestratorDelegates) => orchestrate(delegates),
        } as unknown as OrchestratorAgent,
        { assess } as unknown as PolicyAgent,
        { forClaim: () => recorder } as unknown as TraceService,
    );
    const target = { ...claim, policyId: overrides.policyId ?? claim.policyId } as Claim;
    return { service, traced, claims, assess, run: () => service.run(target, '2026-10-01') };
}

beforeAll(() => jest.spyOn(Logger.prototype, 'error').mockImplementation());

describe('ClaimTriageService', () => {
    it('delegates to the Policy agent via the orchestrator and lets the rules engine decide', async () => {
        const { run, traced, claims, assess } = setup();

        await expect(run()).resolves.toMatchObject({ decision: 'PENDING' });

        expect(assess).toHaveBeenCalledTimes(1);
        expect(traced).toEqual([
            'orchestrator:triage.started',
            'intake:agent.started',
            'intake:agent.completed',
            'orchestrator:agent.started',
            'policy:agent.started',
            'policy:agent.completed',
            'orchestrator:agent.completed',
            'orchestrator:decision',
            'orchestrator:triage.completed',
        ]);
        expect(claims.updateById).toHaveBeenCalledWith(String(claim._id), {
            evidence: { policy: findings },
            summary: 'Policy checked.',
        });
    });

    it('runs the Policy agent only once even if the orchestrator asks twice', async () => {
        const { run, assess } = setup({
            orchestrate: async (delegates) => {
                await delegates.consultPolicy('cover');
                await delegates.consultPolicy('exclusions');
                return 'Checked twice.';
            },
        });
        await run();
        expect(assess).toHaveBeenCalledTimes(1);
    });

    it('enforces the policy check when the orchestrator skips it', async () => {
        const { run, traced, assess } = setup({ orchestrate: async () => 'Skipped delegation.' });

        await expect(run()).resolves.toMatchObject({ decision: 'PENDING' });

        expect(assess).toHaveBeenCalledTimes(1);
        expect(traced).toContain('orchestrator:guard.enforced');
    });

    it('still decides when the orchestrator fails, because the guard runs the required check', async () => {
        const { run, traced } = setup({
            orchestrate: async () => {
                throw new Error('model overloaded');
            },
        });

        await expect(run()).resolves.toMatchObject({ decision: 'PENDING' });
        expect(traced).toEqual(expect.arrayContaining(['orchestrator:agent.failed', 'orchestrator:guard.enforced']));
    });

    it('refers the claim when the Policy agent fails', async () => {
        const { run, traced } = setup({
            assess: async () => {
                throw new Error('model overloaded');
            },
        });

        await expect(run()).resolves.toMatchObject({ decision: 'REFER' });
        expect(traced).toContain('policy:agent.failed');
        expect(traced).not.toContain('orchestrator:guard.enforced');
    });

    it('asks for the policy number without running the Policy agent when the policy does not exist', async () => {
        const { run, assess } = setup({ policyId: 'P-404' });

        await expect(run()).resolves.toMatchObject({ decision: 'NEED_INFO' });
        expect(assess).not.toHaveBeenCalled();
    });

    it('asks for missing facts without starting the orchestrator', async () => {
        const { run, traced } = setup({ extract: async () => ({ ...complete, flightDate: null }) });

        await expect(run()).resolves.toMatchObject({
            decision: 'NEED_INFO',
            reasons: ['On what date was your flight?'],
        });
        expect(traced.some((event) => event.startsWith('policy:'))).toBe(false);
        expect(traced).not.toContain('orchestrator:agent.started');
    });

    it('refers the claim when Intake fails, and still completes the trace', async () => {
        const { run, traced } = setup({
            extract: async () => {
                throw new Error('model unavailable');
            },
        });

        await expect(run()).resolves.toMatchObject({ decision: 'REFER' });
        expect(traced).toEqual([
            'orchestrator:triage.started',
            'intake:agent.started',
            'intake:agent.failed',
            'orchestrator:decision',
            'orchestrator:triage.completed',
        ]);
    });
});
