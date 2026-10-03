import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { FactoryProvider, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MastraModelConfig } from '@mastra/core/llm';
import { APICallError, wrapLanguageModel, type LanguageModel } from 'ai';
import { createOllama } from 'ollama-ai-provider-v2';
import { EnvConfig } from '../config/env.validation';
import { RequestRateLimiter } from './request-rate-limiter';

/** Injection token for the language model every agent uses. Tests override it with a mock model. */
export const LANGUAGE_MODEL = Symbol('LANGUAGE_MODEL');

type ProviderModel = Exclude<LanguageModel, string>;
/** A model after AI SDK middleware: the shape Mastra agents accept. */
type WrappedModel = ReturnType<typeof wrapLanguageModel>;
type ModelSetting = EnvConfig['MODEL'];

const logger = new Logger('LanguageModel');
const FALLBACK_LOG_INTERVAL_MS = 60_000;

/**
 * Builds the language model selected by `MODEL=provider:model-id`, paced by `MODEL_REQUESTS_PER_MINUTE`
 * so all agents together stay under the provider's free-tier quota instead of failing with 429. With
 * `MODEL_FALLBACK` set, a request the primary model can't serve (quota, overload, network) is retried once on
 * the fallback, which has its own pacing because free quotas are counted per model.
 * @param config Validated environment.
 */
export function createLanguageModel(config: ConfigService<EnvConfig, true>): MastraModelConfig {
    const primarySetting = config.get('MODEL', { infer: true });
    const primary = paced(providerModel(config, primarySetting), config);
    const fallbackSetting = config.get('MODEL_FALLBACK', { infer: true });
    if (!fallbackSetting) return primary;

    const fallback = paced(providerModel(config, fallbackSetting), config);
    // While the primary is out of quota every call falls back, so log at most once a minute.
    let lastLoggedAt = 0;
    let since = 0;
    return withFallback(primary, fallback, (error) => {
        since += 1;
        if (Date.now() - lastLoggedAt < FALLBACK_LOG_INTERVAL_MS) return;
        logger.warn(
            `${label(primarySetting)} failed (${error.message.split('\n')[0]}); ` +
                `${since} call(s) retried on ${label(fallbackSetting)}`,
        );
        lastLoggedAt = Date.now();
        since = 0;
    });
}

/**
 * True for failures another model may not have: quota (429), overload or outage (5xx), or no response.
 * Bad requests (400) and unknown model ids (404) are configuration problems and are not retried.
 * @param error What the model call threw.
 */
export function isProviderUnavailable(error: unknown): error is Error {
    if (APICallError.isInstance(error)) {
        return error.statusCode === undefined || error.statusCode === 429 || error.statusCode >= 500;
    }
    return error instanceof TypeError; // fetch failed: DNS, connection reset, offline
}

/**
 * Wraps a model so that a call it can't serve is retried once on another model.
 * @param primary Model tried first.
 * @param fallback Model used when the primary is unavailable.
 * @param onFallback Called with the primary's error before each retry.
 */
export function withFallback(
    primary: WrappedModel,
    fallback: WrappedModel,
    onFallback: (error: Error) => void,
): WrappedModel {
    return wrapLanguageModel({
        model: primary,
        middleware: {
            specificationVersion: 'v4',
            wrapGenerate: async ({ doGenerate, params }) => {
                try {
                    return await doGenerate();
                } catch (error) {
                    if (!isProviderUnavailable(error)) throw error;
                    onFallback(error);
                    return fallback.doGenerate(params);
                }
            },
            wrapStream: async ({ doStream, params }) => {
                try {
                    return await doStream();
                } catch (error) {
                    if (!isProviderUnavailable(error)) throw error;
                    onFallback(error);
                    return fallback.doStream(params);
                }
            },
        },
    });
}

/**
 * Applies the per-model request pacing (none when MODEL_REQUESTS_PER_MINUTE is 0).
 * @param model Provider model.
 * @param config Validated environment.
 */
function paced(model: ProviderModel, config: ConfigService<EnvConfig, true>): WrappedModel {
    const perMinute = config.get('MODEL_REQUESTS_PER_MINUTE', { infer: true });
    const limiter = perMinute ? new RequestRateLimiter(perMinute) : undefined;
    return wrapLanguageModel({
        model,
        middleware: {
            specificationVersion: 'v4',
            transformParams: async ({ params }) => {
                await limiter?.acquire();
                return params;
            },
        },
    });
}

/**
 * "provider:modelId" for logs.
 * @param setting Parsed model setting.
 */
function label({ provider, modelId }: ModelSetting): string {
    return `${provider}:${modelId}`;
}

/**
 * The provider's model, unwrapped.
 * @param config Validated environment.
 * @param setting Which provider and model.
 */
function providerModel(config: ConfigService<EnvConfig, true>, { provider, modelId }: ModelSetting): ProviderModel {
    switch (provider) {
        case 'google':
            return createGoogleGenerativeAI({ apiKey: config.get('GOOGLE_GENERATIVE_AI_API_KEY') })(modelId);
        case 'groq':
            return createGroq({ apiKey: config.get('GROQ_API_KEY') })(modelId);
        case 'ollama':
            return createOllama({ baseURL: config.get('OLLAMA_BASE_URL', { infer: true }) })(modelId);
        default:
            throw new Error(`Unsupported model provider: ${String(provider)}`);
    }
}

export const languageModelProvider: FactoryProvider<MastraModelConfig> = {
    provide: LANGUAGE_MODEL,
    inject: [ConfigService],
    useFactory: createLanguageModel,
};
