import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test';

const USAGE = {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 10, text: 10, reasoning: 0 },
};

/** One model turn: plain text (or JSON text), or a single tool call. */
export type MockStep = { text: string } | { toolCall: { name: string; input: unknown } };

/** What the mock sees on each call, simplified for test responders. */
export interface MockCall {
    /** System instructions, so a shared model can tell agents apart. */
    system: string;
    /** Names of the tools offered on this call. */
    toolNames: string[];
    /** True once a tool result is in the conversation. */
    hasToolResult: boolean;
}

type CallOptions = Parameters<MockLanguageModelV4['doGenerate']>[0];

/**
 * Test model shared by every agent. Answers with fixed text, or asks a responder per call so one model
 * can play Intake, orchestrator, Policy agent and Mastra's structuring pass in the same test.
 * Supports both generate and stream calls (Mastra's structuring pass streams).
 * @param reply Fixed text, or a function returning the next step for a call.
 */
export function mockLanguageModel(reply: string | ((call: MockCall) => MockStep)): MockLanguageModelV4 {
    let callCount = 0;
    const next = (options: CallOptions): MockStep =>
        typeof reply === 'string' ? { text: reply } : reply(describeCall(options));

    return new MockLanguageModelV4({
        doGenerate: async (options: CallOptions) => {
            const step = next(options);
            return {
                content:
                    'text' in step
                        ? [{ type: 'text', text: step.text }]
                        : [
                              {
                                  type: 'tool-call',
                                  toolCallId: `call-${++callCount}`,
                                  toolName: step.toolCall.name,
                                  input: JSON.stringify(step.toolCall.input),
                              },
                          ],
                finishReason: finishReason(step),
                usage: USAGE,
                warnings: [],
            };
        },
        doStream: async (options: CallOptions) => {
            const step = next(options);
            const parts =
                'text' in step
                    ? [
                          { type: 'text-start', id: 't' },
                          { type: 'text-delta', id: 't', delta: step.text },
                          { type: 'text-end', id: 't' },
                      ]
                    : [
                          {
                              type: 'tool-call',
                              toolCallId: `call-${++callCount}`,
                              toolName: step.toolCall.name,
                              input: JSON.stringify(step.toolCall.input),
                          },
                      ];
            return {
                stream: convertArrayToReadableStream([
                    { type: 'stream-start', warnings: [] },
                    ...parts,
                    { type: 'finish', finishReason: finishReason(step), usage: USAGE },
                ]),
            };
        },
    } as ConstructorParameters<typeof MockLanguageModelV4>[0]);
}

/**
 * Finish reason matching the step type.
 * @param step Model turn.
 */
function finishReason(step: MockStep) {
    return 'text' in step ? { unified: 'stop', raw: 'stop' } : { unified: 'tool-calls', raw: 'tool_calls' };
}

/**
 * Extracts what responders need from the raw call options.
 * @param options Call options passed to the model.
 */
function describeCall(options: CallOptions): MockCall {
    const messages = options.prompt as { role: string; content: unknown }[];
    return {
        system: messages
            .filter((message) => message.role === 'system')
            .map((message) => String(message.content))
            .join('\n'),
        toolNames: (options.tools ?? []).map((tool) => tool.name),
        hasToolResult: messages.some((message) => message.role === 'tool'),
    };
}
