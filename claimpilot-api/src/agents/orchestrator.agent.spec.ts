import type { ClaimFacts } from '../claims/claim-facts';
import type { TraceRecorder } from '../trace/trace.service';
import { OrchestratorAgent } from './orchestrator.agent';
import { mockLanguageModel } from './testing/mock-language-model';

const facts: ClaimFacts = {
    flightNumber: '6E2134',
    flightDate: '2026-09-12',
    origin: 'BOM',
    destination: 'DEL',
    claimedDelayMinutes: 240,
    claimedCause: 'fog',
};

describe('OrchestratorAgent', () => {
    it('delegates to the Policy agent through its tool, traces the delegation and returns a summary', async () => {
        const model = mockLanguageModel((call) =>
            call.hasToolResult
                ? { text: 'Policy P-77 covers the flight; fog may be excluded.' }
                : { toolCall: { name: 'consultPolicyAgent', input: { focus: 'cover and exclusions' } } },
        );
        const consultPolicy = jest.fn().mockResolvedValue({ found: true, relevantExclusions: [{ clauseId: '7.3' }] });
        const events: string[] = [];
        const recorder: TraceRecorder = {
            record: async (actor, type, message) => {
                events.push(`${actor}:${type}:${message}`);
                return {} as never;
            },
        };

        const summary = await new OrchestratorAgent(model).run(
            facts,
            { consultPolicy, consultFlight: jest.fn() },
            recorder,
        );

        expect(summary).toBe('Policy P-77 covers the flight; fog may be excluded.');
        expect(consultPolicy).toHaveBeenCalledWith('cover and exclusions');
        expect(events).toEqual(['orchestrator:agent.delegated:Delegated to policy: cover and exclusions']);
    });

    it('fails loudly on an empty answer rather than storing a blank summary', async () => {
        const model = mockLanguageModel('   ');
        await expect(
            new OrchestratorAgent(model).run(
                facts,
                { consultPolicy: jest.fn(), consultFlight: jest.fn() },
                { record: jest.fn() },
            ),
        ).rejects.toThrow('empty summary');
    });

    it('only offers delegation tools, never data tools', async () => {
        const offered = new Set<string>();
        const model = mockLanguageModel((call) => {
            call.toolNames.forEach((name) => offered.add(name));
            return { text: 'Nothing to check.' };
        });
        await new OrchestratorAgent(model).run(
            facts,
            { consultPolicy: jest.fn(), consultFlight: jest.fn() },
            { record: jest.fn() },
        );
        expect([...offered].sort()).toEqual(['consultFlightAgent', 'consultPolicyAgent']);
    });
});
