import { Agent } from '@mastra/core/agent';
import type { MastraModelConfig } from '@mastra/core/llm';
import { createTool } from '@mastra/core/tools';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { ClaimFacts } from '../claims/claim-facts';
import type { TraceRecorder } from '../trace/trace.service';
import { LANGUAGE_MODEL } from './language-model.provider';

/** Sub-agents the orchestrator can call. Implemented by the triage service, which owns the evidence. */
export interface OrchestratorDelegates {
    /**
     * Runs the Policy agent and returns a short briefing for the orchestrator.
     * @param focus What the orchestrator wants to know.
     */
    consultPolicy(focus: string): Promise<Record<string, unknown>>;
}

const INSTRUCTIONS = `You coordinate the triage of a flight-delay insurance claim.

You receive the claim facts, never the claimant's raw message. Delegate to specialist agents through tools:
- consultPolicyAgent: reads the policy wording (cover, how delay is measured, exclusions).

Rules:
- Consult the Policy agent once for every claim before answering.
- You do not approve, reject or calculate payouts; a rules engine does that from the evidence.
- Finish with two or three plain sentences for a claims reviewer: what was checked and what was found,
  including any exclusions the Policy agent flagged.`;

/**
 * LLM orchestrator: decides which sub-agents to call and summarises what they found. It has no data
 * tools of its own, so everything it knows comes through delegation, and every delegation is traced.
 */
@Injectable()
export class OrchestratorAgent {
    constructor(@Inject(LANGUAGE_MODEL) private readonly model: MastraModelConfig) {}

    /**
     * Runs the orchestrator for one claim.
     * @param facts Normalised claim facts.
     * @param delegates Sub-agent calls bound to this claim.
     * @param recorder Trace recorder of the current run.
     * @returns The orchestrator's summary.
     * @throws When the model fails or returns no summary.
     */
    async run(facts: ClaimFacts, delegates: OrchestratorDelegates, recorder: TraceRecorder): Promise<string> {
        const consultPolicyAgent = createTool({
            id: 'consultPolicyAgent',
            description: 'Ask the Policy agent about this claim’s policy: cover, delay measure and exclusions.',
            inputSchema: z.object({ focus: z.string().describe('What you want the Policy agent to check') }),
            execute: async ({ focus }) => {
                await recorder.record('orchestrator', 'agent.delegated', `Delegated to policy: ${focus}`, {
                    data: { to: 'policy', focus },
                });
                return delegates.consultPolicy(focus);
            },
        });

        const agent = new Agent({
            id: 'orchestrator',
            name: 'Orchestrator',
            instructions: INSTRUCTIONS,
            model: this.model,
            tools: { consultPolicyAgent },
        });
        // Plain text is enough for a summary, so no structured-output call is spent here.
        const result = await agent.generate(`Claim facts: ${JSON.stringify(facts)}`, { maxSteps: 3 });
        const summary = result.text.trim();
        if (!summary) throw new Error('Orchestrator returned an empty summary');
        return summary;
    }
}
