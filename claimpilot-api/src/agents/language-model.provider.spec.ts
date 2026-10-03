import { APICallError, generateText, streamText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { isProviderUnavailable, withFallback } from './language-model.provider';
import { mockLanguageModel } from './testing/mock-language-model';

/**
 * Provider error as the AI SDK throws it.
 * @param statusCode HTTP status, or undefined for no response.
 */
function apiError(statusCode: number | undefined): APICallError {
    return new APICallError({
        message: `HTTP ${statusCode ?? 'none'}`,
        url: 'https://model.test',
        requestBodyValues: {},
        statusCode,
    });
}

/**
 * A model whose every call fails with the given error.
 * @param error What to throw.
 */
function failingModel(error: Error) {
    return new MockLanguageModelV4({
        doGenerate: async () => Promise.reject(error),
        doStream: async () => Promise.reject(error),
    });
}

type Wrapped = Parameters<typeof withFallback>[0];

describe('isProviderUnavailable', () => {
    it.each([
        [429, true],
        [503, true],
        [500, true],
        [undefined, true],
        [400, false],
        [404, false],
    ])('status %s → %s', (status, expected) => {
        expect(isProviderUnavailable(apiError(status))).toBe(expected);
    });

    it('treats a network failure as unavailable, and anything else as a real error', () => {
        expect(isProviderUnavailable(new TypeError('fetch failed'))).toBe(true);
        expect(isProviderUnavailable(new Error('schema mismatch'))).toBe(false);
    });
});

describe('withFallback', () => {
    it('answers from the fallback when the primary is over quota, and reports why', async () => {
        const onFallback = jest.fn();
        const model = withFallback(
            failingModel(apiError(429)) as unknown as Wrapped,
            mockLanguageModel('from fallback') as unknown as Wrapped,
            onFallback,
        );

        const { text } = await generateText({ model, prompt: 'hi', maxRetries: 0 });

        expect(text).toBe('from fallback');
        expect(onFallback).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 429 }));
    });

    it('falls back for streamed calls too', async () => {
        const model = withFallback(
            failingModel(apiError(503)) as unknown as Wrapped,
            mockLanguageModel('streamed fallback') as unknown as Wrapped,
            jest.fn(),
        );
        expect(await streamText({ model, prompt: 'hi', maxRetries: 0 }).text).toBe('streamed fallback');
    });

    it('uses the primary when it answers, and never calls the fallback', async () => {
        const fallback = mockLanguageModel('from fallback');
        const model = withFallback(
            mockLanguageModel('from primary') as unknown as Wrapped,
            fallback as unknown as Wrapped,
            jest.fn(),
        );

        expect((await generateText({ model, prompt: 'hi', maxRetries: 0 })).text).toBe('from primary');
        expect(fallback.doGenerateCalls).toHaveLength(0);
    });

    it('does not hide configuration errors behind the fallback', async () => {
        const onFallback = jest.fn();
        const model = withFallback(
            failingModel(apiError(404)) as unknown as Wrapped,
            mockLanguageModel('from fallback') as unknown as Wrapped,
            onFallback,
        );

        await expect(generateText({ model, prompt: 'hi', maxRetries: 0 })).rejects.toThrow('HTTP 404');
        expect(onFallback).not.toHaveBeenCalled();
    });
});
