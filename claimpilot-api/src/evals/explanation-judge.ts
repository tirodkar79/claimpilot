import { Agent } from '@mastra/core/agent';
import type { MastraModelConfig } from '@mastra/core/llm';
import { z } from 'zod';
import type { ClaimOutcome } from '../claims/claims.constants';
import type { JudgeScore } from './evals.constants';

const score = z.number().int().min(1).max(5);
const judgeScoreSchema = z.object({
    clarity: score.describe('Could the claimant follow why this decision was made? 1 = no, 5 = immediately.'),
    faithfulness: score.describe(
        'Does the summary agree with the decision and reasons, without adding claims of its own? 1 = contradicts.',
    ),
    tone: score.describe('Polite and neutral, no accusation of fraud, no blame? 1 = hostile, 5 = professional.'),
    comment: z.string().describe('One sentence on the weakest point.'),
});

const INSTRUCTIONS = `You grade the written explanation of an insurance claim decision.
Grade only the text: you are not asked whether the decision is right, the rules engine decided it.
Score each criterion from 1 to 5 using the descriptions given.`;

/**
 * LLM-as-judge for explanation quality. It never grades the decision itself (that is checked exactly), only
 * how well the reasons and summary explain it. Judges have their own bias, so its scores are reported, not gated.
 */
export class ExplanationJudge {
    private readonly agent: Agent;

    constructor(model: MastraModelConfig) {
        this.agent = new Agent({
            id: 'explanation-judge',
            name: 'Explanation judge',
            instructions: INSTRUCTIONS,
            model,
        });
    }

    /**
     * Scores one decision's explanation.
     * @param outcome Decision with its reasons.
     * @param summary Summary shown to the reviewer.
     */
    async grade(outcome: ClaimOutcome, summary: string | undefined): Promise<JudgeScore> {
        const prompt = [
            `Decision: ${outcome.decision}`,
            'Reasons given to the claimant:\n' + outcome.reasons.map((reason) => `- ${reason}`).join('\n'),
            `Summary for the reviewer: ${summary ?? '(none)'}`,
        ].join('\n\n');
        const result = await this.agent.generate(prompt, {
            structuredOutput: { schema: judgeScoreSchema, jsonPromptInjection: true },
        });
        return judgeScoreSchema.parse(result.object);
    }
}
