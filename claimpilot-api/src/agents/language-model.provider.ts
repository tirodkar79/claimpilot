import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { FactoryProvider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MastraModelConfig } from '@mastra/core/llm';
import { wrapLanguageModel, type LanguageModel } from 'ai';
import { createOllama } from 'ollama-ai-provider-v2';
import { EnvConfig } from '../config/env.validation';
import { RequestRateLimiter } from './request-rate-limiter';

/** Injection token for the language model every agent uses. Tests override it with a mock model. */
export const LANGUAGE_MODEL = Symbol('LANGUAGE_MODEL');

/**
 * Builds the language model selected by `MODEL=provider:model-id`, paced by `MODEL_REQUESTS_PER_MINUTE`
 * so all agents together stay under the provider's free-tier quota instead of failing with 429.
 * @param config Validated environment.
 */
export function createLanguageModel(config: ConfigService<EnvConfig, true>): MastraModelConfig {
    const model = providerModel(config);
    const perMinute = config.get('MODEL_REQUESTS_PER_MINUTE', { infer: true });
    if (!perMinute) return model;

    const limiter = new RequestRateLimiter(perMinute);
    return wrapLanguageModel({
        model: model as Exclude<LanguageModel, string>,
        middleware: {
            specificationVersion: 'v4',
            transformParams: async ({ params }) => {
                await limiter.acquire();
                return params;
            },
        },
    });
}

/**
 * The provider's model, unwrapped.
 * @param config Validated environment.
 */
function providerModel(config: ConfigService<EnvConfig, true>) {
    const { provider, modelId } = config.get('MODEL', { infer: true });
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
