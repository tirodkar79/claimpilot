import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import type { FlightAgent, FlightFindings } from '../agents/flight.agent';
import type { IntakeAgent, IntakeExtraction } from '../agents/intake.agent';
import type { OrchestratorAgent, OrchestratorDelegates } from '../agents/orchestrator.agent';
import type { PolicyAgent, PolicyFindings } from '../agents/policy.agent';
import { recordedLegs } from '../flights/recorded-flights';
import type { PoliciesRepository } from '../policies/policies.repository';
import { POLICY_SEEDS } from '../policies/policies.seed';
import type { TraceRecorder, TraceService } from '../trace/trace.service';
import type { Claim } from './claim.schema';
import { ClaimTriageService } from './claim-triage.service';
import type { ClaimsRepository } from './claims.repository';

const complete: IntakeExtraction = {
    flightNumber: '6E-2134',
    flightDate: '2026-09-22',
    origin: 'BOM',
    destination: 'DEL',
    claimedDelayMinutes: 240,
    claimedCause: 'technical fault',
};

const policyFindings: PolicyFindings = {
    policyId: 'P-77',
    delayMeasure: 'departure',
    delayMeasureMismatch: false,
    relevantExclusions: [],
    summary: 'No exclusions apply.',
    citedClauses: [],
    droppedCitations: [],
};

const flightFindings: FlightFindings = {
    flightNumber: '6E2134',
    claimedDate: '2026-09-22',
    leg: recordedLegs('6E2134', '2026-09-22')[0], // 230 min late
    source: 'recorded',
    selectedBy: 'agent',
    notes: 'Found.',
    lookups: [{ date: '2026-09-22', legs: 1 }],
};

const claim = {
    _id: new Types.ObjectId(),
    customerId: 'C-1042',
    policyId: 'P-77',
    message: 'My flight 6E-2134 was delayed 4 hours',
    createdAt: new Date('2026-09-25T10:00:00Z'),
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
        investigate?: () => Promise<FlightFindings>;
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
    const assess = jest.fn(overrides.assess ?? (async () => policyFindings));
    const investigate = jest.fn(overrides.investigate ?? (async () => flightFindings));
    const orchestrate: Orchestrate =
        overrides.orchestrate ??
        (async (delegates) => {
            await Promise.all([delegates.consultPolicy('cover'), delegates.consultFlight('times')]);
            return 'Checked policy and flight.';
        });

    const service = new ClaimTriageService(
        { get: () => 'Asia/Kolkata' } as unknown as ConfigService<never, true>,
        claims as unknown as ClaimsRepository,
        {
            findByPolicyId: async (id: string) => POLICY_SEEDS.find((p) => p.policyId === id) ?? null,
        } as unknown as PoliciesRepository,
        { extract: jest.fn(overrides.extract ?? (async () => complete)) } as unknown as IntakeAgent,
        {
            run: (_facts: unknown, delegates: OrchestratorDelegates) => orchestrate(delegates),
        } as unknown as OrchestratorAgent,
        { assess } as unknown as PolicyAgent,
        { investigate } as unknown as FlightAgent,
        { forClaim: () => recorder } as unknown as TraceService,
    );
    const target = { ...claim, policyId: overrides.policyId ?? claim.policyId } as Claim;
    return { traced, claims, assess, investigate, run: () => service.run(target, '2026-09-25') };
}

beforeAll(() => jest.spyOn(Logger.prototype, 'error').mockImplementation());

describe('ClaimTriageService', () => {
    it('delegates to both agents and approves the tier the flight record reaches', async () => {
        const { run, traced, claims } = setup();

        await expect(run()).resolves.toMatchObject({ decision: 'APPROVE', payout: { amount: 2000 } });

        expect(traced).toEqual(
            expect.arrayContaining([
                'policy:agent.completed',
                'flight:agent.completed',
                'orchestrator:agent.completed',
            ]),
        );
        expect(traced).not.toContain('orchestrator:guard.enforced');
        expect(claims.updateById).toHaveBeenCalledWith(String(claim._id), {
            evidence: { policy: policyFindings, flight: flightFindings },
            summary: 'Checked policy and flight.',
        });
    });

    it('runs each agent only once even if the orchestrator asks twice', async () => {
        const { run, assess, investigate } = setup({
            orchestrate: async (delegates) => {
                await delegates.consultFlight('times');
                await delegates.consultFlight('again');
                await delegates.consultPolicy('cover');
                return 'Asked twice.';
            },
        });
        await run();
        expect(assess).toHaveBeenCalledTimes(1);
        expect(investigate).toHaveBeenCalledTimes(1);
    });

    it('enforces only the agents the orchestrator skipped', async () => {
        const { run, traced, investigate } = setup({
            orchestrate: async (delegates) => {
                await delegates.consultPolicy('cover');
                return 'Only checked the policy.';
            },
        });

        await expect(run()).resolves.toMatchObject({ decision: 'APPROVE' });

        expect(investigate).toHaveBeenCalledTimes(1);
        expect(traced.filter((event) => event === 'orchestrator:guard.enforced')).toHaveLength(1);
    });

    it('still decides when the orchestrator fails, because the guard runs both agents', async () => {
        const { run, traced } = setup({
            orchestrate: async () => {
                throw new Error('model overloaded');
            },
        });

        await expect(run()).resolves.toMatchObject({ decision: 'APPROVE' });
        expect(traced.filter((event) => event === 'orchestrator:guard.enforced')).toHaveLength(2);
    });

    it.each([
        ['Policy', { assess: async () => Promise.reject(new Error('overloaded')) }, 'policy:agent.failed'],
        ['Flight', { investigate: async () => Promise.reject(new Error('429')) }, 'flight:agent.failed'],
    ])('refers the claim when the %s agent fails', async (_label, override, failure) => {
        const { run, traced } = setup(override);
        await expect(run()).resolves.toMatchObject({ decision: 'REFER' });
        expect(traced).toContain(failure);
    });

    it('asks for the policy number without running any agent when the policy does not exist', async () => {
        const { run, assess, investigate } = setup({ policyId: 'P-404' });

        await expect(run()).resolves.toMatchObject({ decision: 'NEED_INFO' });
        expect(assess).not.toHaveBeenCalled();
        expect(investigate).not.toHaveBeenCalled();
    });

    it('asks for missing facts without starting the orchestrator', async () => {
        const { run, traced } = setup({ extract: async () => ({ ...complete, flightDate: null }) });

        await expect(run()).resolves.toMatchObject({
            decision: 'NEED_INFO',
            reasons: ['On what date was your flight?'],
        });
        expect(traced).not.toContain('orchestrator:agent.started');
    });

    it('refers the claim when Intake fails, and still completes the trace', async () => {
        const { run, traced } = setup({ extract: async () => Promise.reject(new Error('model unavailable')) });

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
