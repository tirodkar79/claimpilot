import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import type { IntakeAgent, IntakeExtraction } from '../agents/intake.agent';
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

const claim = { _id: new Types.ObjectId(), message: 'My flight 6E-2134 was delayed 4 hours' } as Claim;

/**
 * Builds the service with an Intake stub and records what it traced and stored.
 * @param extract Intake agent behaviour.
 */
function setup(extract: () => Promise<IntakeExtraction>) {
    const traced: { actor: string; type: string; message: string }[] = [];
    const recorder: TraceRecorder = {
        record: jest.fn(async (actor, type, message) => {
            traced.push({ actor, type, message });
            return {} as never;
        }),
    };
    const claims = { updateById: jest.fn().mockResolvedValue(null) };
    const service = new ClaimTriageService(
        claims as unknown as ClaimsRepository,
        { extract: jest.fn(extract) } as unknown as IntakeAgent,
        { forClaim: () => recorder } as unknown as TraceService,
    );
    return { service, traced, claims };
}

beforeAll(() => jest.spyOn(Logger.prototype, 'error').mockImplementation());

describe('ClaimTriageService', () => {
    it('marks a complete claim PENDING and traces each step in order', async () => {
        const { service, traced, claims } = setup(async () => complete);

        await expect(service.run(claim, '2026-10-01')).resolves.toMatchObject({ decision: 'PENDING' });

        expect(traced.map((e) => `${e.actor}:${e.type}`)).toEqual([
            'orchestrator:triage.started',
            'intake:agent.started',
            'intake:agent.completed',
            'orchestrator:decision',
            'orchestrator:triage.completed',
        ]);
        expect(claims.updateById).toHaveBeenCalledWith(String(claim._id), {
            facts: expect.objectContaining({ flightNumber: '6E2134' }),
        });
        expect(claims.updateById).toHaveBeenLastCalledWith(String(claim._id), {
            outcome: expect.objectContaining({ decision: 'PENDING' }),
            status: 'completed',
        });
    });

    it('asks for missing facts with NEED_INFO', async () => {
        const { service } = setup(async () => ({ ...complete, flightDate: null, claimedDelayMinutes: null }));

        const outcome = await service.run(claim, '2026-10-01');

        expect(outcome.decision).toBe('NEED_INFO');
        expect(outcome.reasons).toEqual(['On what date was your flight?', 'Roughly how long was your flight delayed?']);
    });

    it('refers the claim to a human when Intake fails, and still completes the trace', async () => {
        const { service, traced, claims } = setup(async () => {
            throw new Error('model unavailable');
        });

        await expect(service.run(claim, '2026-10-01')).resolves.toMatchObject({ decision: 'REFER' });

        expect(traced.map((e) => e.type)).toEqual([
            'triage.started',
            'agent.started',
            'agent.failed',
            'decision',
            'triage.completed',
        ]);
        expect(claims.updateById).toHaveBeenCalledTimes(1);
        expect(claims.updateById).toHaveBeenCalledWith(String(claim._id), {
            outcome: expect.objectContaining({ decision: 'REFER' }),
            status: 'completed',
        });
    });
});
