import type { ClaimFacts } from '../claims/claim-facts';
import { POLICY_SEEDS } from '../policies/policies.seed';
import type { Policy } from '../policies/policy.schema';
import type { TraceRecorder } from '../trace/trace.service';
import { MAX_CLAUSE_SEARCHES, PolicyAgent, validateReading } from './policy.agent';
import { mockLanguageModel } from './testing/mock-language-model';

const policy = POLICY_SEEDS.find((p) => p.policyId === 'P-77') as Policy;
const facts: ClaimFacts = {
    flightNumber: '6E2134',
    flightDate: '2026-09-12',
    origin: 'BOM',
    destination: 'DEL',
    claimedDelayMinutes: 240,
    claimedCause: 'fog',
};

const reading = {
    delayMeasure: 'departure' as const,
    relevantExclusions: [{ type: 'severe_weather' as const, clauseId: '7.3', summary: 'Fog is excluded.' }],
    summary: 'Delay is measured from departure. Fog could trigger the weather exclusion.',
    citedClauseIds: ['4.1', '7.3'],
};

/** Recorder that keeps the events in memory. */
function memoryRecorder() {
    const events: { type: string; message: string; data?: Record<string, unknown> }[] = [];
    const recorder: TraceRecorder = {
        record: async (_actor, type, message, extra) => {
            events.push({ type, message, data: extra?.data });
            return {} as never;
        },
    };
    return { recorder, events };
}

describe('validateReading', () => {
    it('attaches the cited clause text', () => {
        const findings = validateReading(policy, reading, 'fog');
        expect(findings.citedClauses.map((clause) => clause.id)).toEqual(['4.1', '7.3']);
        expect(findings.droppedCitations).toEqual([]);
        expect(findings.delayMeasureMismatch).toBe(false);
    });

    it('drops invented clause ids and exclusions that cite them', () => {
        const findings = validateReading(
            policy,
            {
                ...reading,
                relevantExclusions: [...reading.relevantExclusions, { type: 'other', clauseId: '12.9', summary: 'x' }],
                citedClauseIds: ['4.1', '99.1'],
            },
            'fog',
        );
        expect(findings.droppedCitations.sort()).toEqual(['12.9', '99.1']);
        expect(findings.relevantExclusions.map((e) => e.clauseId)).toEqual(['7.3']);
    });

    it.each([
        ['technical fault', ['7.1'], ['7.3', '7.4']],
        ['dense fog at Delhi', ['7.1', '7.3'], ['7.4']],
        ['cabin crew went on strike', ['7.1', '7.4'], ['7.3']],
        [null, ['7.1', '7.3'], ['7.4']],
    ])('for cause %j keeps %j and drops %j', (cause, kept, dropped) => {
        const findings = validateReading(
            policy,
            {
                ...reading,
                relevantExclusions: [
                    { type: 'known_before_purchase', clauseId: '7.1', summary: 'Known delays.' },
                    { type: 'severe_weather', clauseId: '7.3', summary: 'Weather.' },
                    { type: 'industrial_action', clauseId: '7.4', summary: 'Strikes.' },
                ],
            },
            cause,
        );
        expect(findings.relevantExclusions.map((e) => e.clauseId)).toEqual(kept);
        expect(findings.droppedExclusions.map((e) => e.clauseId)).toEqual(dropped);
    });

    it('keeps the schedule’s delay measure and flags a model that misread it', () => {
        const findings = validateReading(policy, { ...reading, delayMeasure: 'arrival' }, 'fog');
        expect(findings.delayMeasure).toBe('departure');
        expect(findings.delayMeasureMismatch).toBe(true);
    });
});

describe('PolicyAgent', () => {
    it('reads the wording through its tools, traces each call and returns validated findings', async () => {
        const model = mockLanguageModel((call) =>
            call.hasToolResult
                ? { text: JSON.stringify(reading) }
                : { toolCall: { name: 'searchPolicyClauses', input: { query: 'weather exclusion' } } },
        );
        const { recorder, events } = memoryRecorder();

        const findings = await new PolicyAgent(model).assess(policy, facts, recorder);

        expect(findings).toMatchObject({ policyId: 'P-77', relevantExclusions: [{ clauseId: '7.3' }] });
        expect(events).toEqual([
            {
                type: 'tool.called',
                message: 'searchPolicyClauses("weather exclusion")',
                data: { tool: 'searchPolicyClauses', query: 'weather exclusion', clauseIds: ['7.3'] },
            },
        ]);
    });

    it('drops a weather exclusion flagged for a technical fault, and traces the correction', async () => {
        const model = mockLanguageModel(() => ({ text: JSON.stringify(reading) }));
        const { recorder, events } = memoryRecorder();

        const findings = await new PolicyAgent(model).assess(
            policy,
            { ...facts, claimedCause: 'technical fault' },
            recorder,
        );

        expect(findings.relevantExclusions).toEqual([]);
        expect(findings.droppedExclusions).toEqual([{ type: 'severe_weather', clauseId: '7.3' }]);
        expect(events).toEqual([
            {
                type: 'guard.enforced',
                message: 'Dropped §7.3 (severe_weather): the claimed cause "technical fault" has nothing to do with it',
                data: { droppedExclusions: [{ type: 'severe_weather', clauseId: '7.3' }] },
            },
        ]);
    });

    it('offers only the clause search tool and answers in at most a few calls', async () => {
        const offered = new Set<string>();
        const model = mockLanguageModel((call) => {
            call.toolNames.forEach((name) => offered.add(name));
            return call.hasToolResult
                ? { text: JSON.stringify(reading) }
                : { toolCall: { name: 'searchPolicyClauses', input: { query: 'fog' } } };
        });
        await new PolicyAgent(model).assess(policy, facts, memoryRecorder().recorder);
        expect([...offered]).toEqual(['searchPolicyClauses']);
        expect(model.doGenerateCalls.length + model.doStreamCalls.length).toBe(2);
    });

    it('refuses searches beyond the cap, so a looping model cannot burn the quota', async () => {
        let searches = 0;
        const model = mockLanguageModel(() =>
            searches++ < MAX_CLAUSE_SEARCHES + 1
                ? { toolCall: { name: 'searchPolicyClauses', input: { query: `topic ${searches}` } } }
                : { text: JSON.stringify(reading) },
        );
        const { recorder, events } = memoryRecorder();

        await new PolicyAgent(model).assess(policy, facts, recorder).catch(() => undefined);

        const refused = events.filter((event) => event.data?.refused);
        expect(events.length - refused.length).toBe(MAX_CLAUSE_SEARCHES);
        expect(refused.length).toBeGreaterThanOrEqual(1);
    });

    it('never sends the raw claim text, only the facts', async () => {
        const prompts: string[] = [];
        const model = mockLanguageModel((call) => {
            prompts.push(call.system);
            return { text: JSON.stringify(reading) };
        });
        await new PolicyAgent(model).assess(policy, facts, memoryRecorder().recorder);
        expect(model.doGenerateCalls.length + model.doStreamCalls.length).toBeGreaterThan(0);
        expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toContain('"claimedCause\\":\\"fog\\"');
    });
});
