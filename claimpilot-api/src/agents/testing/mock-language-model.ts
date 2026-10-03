import { MockLanguageModelV4 } from 'ai/test';

const USAGE = {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 10, text: 10, reasoning: 0 },
};

/**
 * Test model that answers every call with the given text (or throws), recording the prompts.
 * @param reply Text to return, or a function producing it per call.
 */
export function mockLanguageModel(reply: string | (() => string)): MockLanguageModelV4 {
    return new MockLanguageModelV4({
        doGenerate: async () => ({
            content: [{ type: 'text', text: typeof reply === 'function' ? reply() : reply }],
            finishReason: { unified: 'stop', raw: 'stop' },
            usage: USAGE,
            warnings: [],
        }),
    } as ConstructorParameters<typeof MockLanguageModelV4>[0]);
}
