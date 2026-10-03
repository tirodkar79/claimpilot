import { Agent } from '@mastra/core/agent';
import type { MastraModelConfig } from '@mastra/core/llm';
import { createTool } from '@mastra/core/tools';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { ClaimFacts } from '../claims/claim-facts';
import type { TraceActor } from '../trace/trace.constants';
import type { TraceRecorder } from '../trace/trace.service';
import { LANGUAGE_MODEL } from './language-model.provider';

/** Sub-agents the orchestrator can call. Implemented by the triage service, which owns the evidence. */
export interface OrchestratorDelegates {
    /**
     * Runs the Policy agent and returns a short briefing for the orchestrator.
     * @param focus What the orchestrator wants to know.
     */
    consultPolicy(focus: string): Promise<Record<string, unknown>>;

    /**
     * Runs the Flight evidence agent and returns a short briefing for the orchestrator.
     * @param focus What the orchestrator wants to know.
     */
    consultFlight(focus: string): Promise<Record<string, unknown>>;

    /**
     * Runs the Weather agent (via the Open-Meteo MCP server) and returns a short briefing.
     * @param focus What the orchestrator wants to know.
     */
    consultWeather(focus: string): Promise<Record<string, unknown>>;
}

const INSTRUCTIONS = `You coordinate the triage of a flight-delay insurance claim.

You receive the claim facts, never the claimant's raw message. Delegate to specialist agents through tools:
- consultPolicyAgent: reads the policy wording (cover, how delay is measured, exclusions).
- consultFlightAgent: finds what actually happened to the flight (scheduled and actual times).
- consultWeatherAgent: checks historical weather at both airports during the delay.

Rules:
- Consult the Policy and Flight agents once for every claim; you can call them in the same step.
- Consult the Weather agent only if the Policy agent flagged a severe-weather exclusion. Otherwise don't:
  it costs time and can't change the outcome.
- You do not approve, reject or calculate payouts; a rules engine does that from the evidence.
- Finish with two or three plain sentences for a claims reviewer: what was checked and what was found,
  including any exclusions the Policy agent flagged, whether the flight record was found, and the weather
  if it was checked.`;

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
        const agent = new Agent({
            id: 'orchestrator',
            name: 'Orchestrator',
            instructions: INSTRUCTIONS,
            model: this.model,
            tools: {
                consultPolicyAgent: delegationTool(
                    'consultPolicyAgent',
                    'policy',
                    'Ask the Policy agent about cover, delay measure and exclusions.',
                    (focus) => delegates.consultPolicy(focus),
                    recorder,
                ),
                consultFlightAgent: delegationTool(
                    'consultFlightAgent',
                    'flight',
                    'Ask the Flight evidence agent what happened to the flight.',
                    (focus) => delegates.consultFlight(focus),
                    recorder,
                ),
                consultWeatherAgent: delegationTool(
                    'consultWeatherAgent',
                    'weather',
                    'Ask the Weather agent about severe weather at the airports. Only for a weather exclusion.',
                    (focus) => delegates.consultWeather(focus),
                    recorder,
                ),
            },
        });
        // Plain text is enough for a summary, so no structured-output call is spent here.
        const result = await agent.generate(`Claim facts: ${JSON.stringify(facts)}`, { maxSteps: 4 });
        const summary = result.text.trim();
        if (!summary) throw new Error('Orchestrator returned an empty summary');
        return summary;
    }
}

/**
 * A tool that hands work to one sub-agent and traces the hand-off.
 * @param id Tool name shown to the model.
 * @param to Sub-agent the tool delegates to.
 * @param description What the tool is for, as shown to the model.
 * @param delegate Runs the sub-agent.
 * @param recorder Trace recorder of the current run.
 */
function delegationTool(
    id: string,
    to: TraceActor,
    description: string,
    delegate: (focus: string) => Promise<Record<string, unknown>>,
    recorder: TraceRecorder,
) {
    return createTool({
        id,
        description,
        inputSchema: z.object({ focus: z.string().describe(`What you want the ${to} agent to check`) }),
        execute: async ({ focus }) => {
            await recorder.record('orchestrator', 'agent.delegated', `Delegated to ${to}: ${focus}`, {
                data: { to, focus },
            });
            return delegate(focus);
        },
    });
}
