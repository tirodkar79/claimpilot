import { Agent } from '@mastra/core/agent';
import type { MastraModelConfig } from '@mastra/core/llm';
import { createTool } from '@mastra/core/tools';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { ClaimFacts } from '../claims/claim-facts';
import { searchClauses } from '../policies/clause-search';
import { DELAY_MEASURES, type Policy, type PolicyClause } from '../policies/policy.schema';
import type { TraceRecorder } from '../trace/trace.service';
import { LANGUAGE_MODEL } from './language-model.provider';

export const EXCLUSION_TYPES = ['severe_weather', 'industrial_action', 'known_before_purchase', 'other'] as const;

/** What the Policy agent must return after reading the wording. */
const policyReadingSchema = z.object({
    delayMeasure: z.enum(DELAY_MEASURES).describe('How the wording says delay is measured'),
    relevantExclusions: z
        .array(
            z.object({
                type: z.enum(EXCLUSION_TYPES),
                clauseId: z.string().describe('Clause number exactly as returned by a tool, e.g. "7.3"'),
                summary: z.string().describe('One sentence: what the clause excludes'),
            }),
        )
        .describe('Exclusions that could apply to this claim. Empty if none.'),
    summary: z.string().describe('Two sentences for a claims reviewer'),
    citedClauseIds: z.array(z.string()).describe('Every clause number the answer relies on'),
});

type PolicyReading = z.infer<typeof policyReadingSchema>;

/** Policy agent result, after code has checked its citations against the real wording. */
export interface PolicyFindings extends Omit<PolicyReading, 'citedClauseIds'> {
    policyId: string;
    /** Cited clauses that exist in the policy, with their text, for the reviewer. */
    citedClauses: PolicyClause[];
    /** Clause ids the model cited that don't exist; non-empty means a grounding failure. */
    droppedCitations: string[];
    /** True when the model's reading of the delay measure disagreed with the policy schedule. */
    delayMeasureMismatch: boolean;
}

/** Hard cap on clause searches per claim; the agent is told to answer once it is reached. */
export const MAX_CLAUSE_SEARCHES = 3;

const INSTRUCTIONS = `You read a travel insurance policy for a flight-delay claim.

The prompt gives you the policy schedule and its list of clauses. Use searchPolicyClauses to read the
wording you need; one query can cover several topics (e.g. "delay measured weather exclusion").
You may search at most ${MAX_CLAUSE_SEARCHES} times.

Report:
- how the wording says delay is measured (from scheduled departure or scheduled arrival);
- every exclusion that could apply to this claim, given its claimed cause;
- the clause numbers you relied on.

Rules:
- Cite only clause numbers from the schedule or the search results, exactly as written. Never invent one.
- The claimed cause is the claimant's assertion, not a verified fact. Report exclusions it might trigger;
  don't decide whether they apply.
- You do not approve or reject claims.`;

/**
 * Reads a policy's wording for a claim. Its only tool is bound to one policy, so the model cannot look
 * at another customer's policy. Numbers used for decisions (dates, tiers) come from the schedule in
 * code; this agent contributes the reading of the wording, which code then checks.
 */
@Injectable()
export class PolicyAgent {
    constructor(@Inject(LANGUAGE_MODEL) private readonly model: MastraModelConfig) {}

    /**
     * Reads the policy for this claim and validates the answer against the real clauses.
     * Typical cost: 2–3 model calls (search, maybe a second search, JSON answer).
     * @param policy Policy the claim is made under.
     * @param facts Normalised claim facts (never the raw claimant text).
     * @param recorder Trace recorder of the current triage run.
     * @throws When the model fails or its output doesn't match the schema.
     */
    async assess(policy: Policy, facts: ClaimFacts, recorder: TraceRecorder): Promise<PolicyFindings> {
        const agent = new Agent({
            id: 'policy',
            name: 'Policy',
            instructions: INSTRUCTIONS,
            model: this.model,
            tools: { searchPolicyClauses: this.searchTool(policy, recorder) },
        });

        const schedule = {
            policyId: policy.policyId,
            product: policy.product,
            coverageStart: policy.coverageStart,
            coverageEnd: policy.coverageEnd,
            payoutTiers: policy.payoutTiers,
            clauses: policy.clauses.map(({ id, title }) => ({ id, title })),
        };
        const prompt =
            `Policy schedule: ${JSON.stringify(schedule)}\n` +
            `Claim facts (claimedDelayMinutes and claimedCause are the claimant's assertions): ${JSON.stringify(facts)}`;
        // JSON is requested in the prompt rather than via a native response format: some providers (e.g. Groq)
        // reject tools and a response format in the same call, and this avoids a separate structuring call.
        const result = await agent.generate(prompt, {
            maxSteps: MAX_CLAUSE_SEARCHES + 1,
            structuredOutput: { schema: policyReadingSchema, jsonPromptInjection: true },
        });
        return validateReading(policy, policyReadingSchema.parse(result.object));
    }

    /**
     * Clause search bound to one policy. Every call is traced; calls past the cap are refused.
     * @param policy Policy the tool reads from.
     * @param recorder Trace recorder of the current run.
     */
    private searchTool(policy: Policy, recorder: TraceRecorder) {
        let searches = 0;
        return createTool({
            id: 'searchPolicyClauses',
            description: 'Keyword search over this policy’s wording. Returns up to 3 clauses with full text.',
            inputSchema: z.object({ query: z.string().describe('e.g. "delay measured weather exclusion"') }),
            execute: async ({ query }) => {
                searches += 1;
                if (searches > MAX_CLAUSE_SEARCHES) {
                    await recorder.record('policy', 'tool.called', `searchPolicyClauses("${query}") refused`, {
                        data: { tool: 'searchPolicyClauses', query, refused: true },
                    });
                    return { error: 'Search limit reached. Answer now with what you have read.' };
                }
                const clauses = searchClauses(policy.clauses, query);
                await recorder.record('policy', 'tool.called', `searchPolicyClauses("${query}")`, {
                    data: { tool: 'searchPolicyClauses', query, clauseIds: clauses.map((c) => c.id) },
                });
                return { clauses };
            },
        });
    }
}

/**
 * Keeps only citations that exist in the policy and flags disagreement with the schedule.
 * @param policy Policy that was read.
 * @param reading Model output.
 */
export function validateReading(policy: Policy, reading: PolicyReading): PolicyFindings {
    const clauseIds = new Set(policy.clauses.map((clause) => clause.id));
    const cited = new Set([...reading.citedClauseIds, ...reading.relevantExclusions.map((e) => e.clauseId)]);

    return {
        policyId: policy.policyId,
        delayMeasure: policy.delayMeasure,
        delayMeasureMismatch: reading.delayMeasure !== policy.delayMeasure,
        relevantExclusions: reading.relevantExclusions.filter((exclusion) => clauseIds.has(exclusion.clauseId)),
        summary: reading.summary,
        citedClauses: policy.clauses.filter((clause) => cited.has(clause.id)),
        droppedCitations: [...cited].filter((id) => !clauseIds.has(id)),
    };
}
