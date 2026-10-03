import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import type { Claim } from '../claims/claim.schema';
import type { ClaimTriageService } from '../claims/claim-triage.service';
import type { ClaimsRepository } from '../claims/claims.repository';
import type { TraceRepository } from '../trace/trace.repository';
import type { EvalCase } from './evals.constants';
import { EvalRunner, providerError } from './eval-runner';
import { EvalWeatherStub } from './eval-weather.stub';
import type { ExplanationJudge } from './explanation-judge';

const evalCase: EvalCase = {
    id: 'duplicate-paid',
    title: 'Paid already',
    tests: 'duplicate',
    source: 'scenario',
    input: { customerId: 'C-1042', policyId: 'P-77', message: 'late' },
    weather: { kind: 'down' },
    priorClaims: [{ decision: 'APPROVE', flightNumber: '6E2134', flightDate: '2026-09-30' }],
    expect: { decision: 'REJECT' },
};

/**
 * Builds a runner over in-memory claims; triage stores the given decision and trace.
 * @param decision Decision triage stores.
 * @param failure Error recorded on a failed agent, if any.
 */
function setup(decision: 'REJECT' | 'REFER', failure?: string) {
    const stored = new Map<string, Claim>();
    const claims = {
        create: jest.fn(async (fields: Partial<Claim>) => {
            const claim = { ...fields, _id: new Types.ObjectId() } as Claim;
            stored.set(String(claim._id), claim);
            return claim;
        }),
        findById: async (id: string) => stored.get(id) ?? null,
    };
    const triage = {
        run: jest.fn(async (claim: Claim) => {
            stored.set(String(claim._id), { ...claim, outcome: { decision, reasons: ['r'], citations: [] } });
        }),
    };
    const traces = {
        findByClaim: async () => (failure ? [{ actor: 'policy', type: 'agent.failed', data: { error: failure } }] : []),
    };
    const weather = new EvalWeatherStub();
    const judge = { grade: jest.fn().mockResolvedValue({ clarity: 5, faithfulness: 5, tone: 5, comment: '' }) };
    const reset = jest.fn().mockResolvedValue(undefined);
    const runner = new EvalRunner({
        claims: claims as unknown as ClaimsRepository,
        traces: traces as unknown as TraceRepository,
        triage: triage as unknown as ClaimTriageService,
        weather,
        reset,
        judge: judge as unknown as ExplanationJudge,
    });
    return { runner, claims, triage, weather, judge, reset };
}

beforeAll(() => jest.spyOn(Logger.prototype, 'log').mockImplementation());

describe('EvalRunner', () => {
    it('resets, seeds prior claims and weather, runs triage per attempt and grades it', async () => {
        const { runner, claims, triage, weather, judge, reset } = setup('REJECT');
        const archive = jest.spyOn(weather, 'use');

        const [result] = await runner.run([evalCase], 2);

        expect(reset).toHaveBeenCalledTimes(2);
        expect(archive).toHaveBeenCalledWith({ kind: 'down' });
        expect(claims.create).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'completed', outcome: expect.objectContaining({ decision: 'APPROVE' }) }),
        );
        expect(triage.run).toHaveBeenCalledTimes(2);
        expect(judge.grade).toHaveBeenCalledTimes(2);
        expect(result).toMatchObject({ id: 'duplicate-paid', expectedDecision: 'REJECT' });
        expect(result.attempts[0]).toMatchObject({
            decision: 'REJECT',
            checks: expect.arrayContaining([
                { dimension: 'decision', name: 'decision', pass: true, detail: 'expected REJECT, got REJECT' },
            ]),
        });
    });

    it('marks an attempt broken by the model provider as an error, unjudged', async () => {
        const { runner, judge } = setup('REFER', 'You exceeded your current quota');
        const [result] = await runner.run([evalCase], 1);
        expect(result.attempts[0].error).toBe('Model provider error: You exceeded your current quota');
        expect(judge.grade).not.toHaveBeenCalled();
    });

    it('records a crash as an error instead of stopping the run', async () => {
        const { runner, triage } = setup('REJECT');
        triage.run.mockRejectedValueOnce(new Error('db down'));
        const [result] = await runner.run([evalCase], 1);
        expect(result.attempts[0]).toMatchObject({ error: 'db down', checks: [] });
    });
});

describe('providerError', () => {
    it('ignores injected and ordinary failures', () => {
        expect(providerError([{ type: 'agent.failed', data: { error: 'Injected failure: flight' } }])).toBeUndefined();
        expect(providerError([{ type: 'agent.failed', data: { error: '503 model overloaded' } }])).toBe(
            '503 model overloaded',
        );
    });
});
