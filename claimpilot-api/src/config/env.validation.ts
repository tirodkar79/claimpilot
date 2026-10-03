import { z } from 'zod';
import { Role } from '../auth/auth.constants';

const roles = Object.values(Role) as string[];

export const MODEL_PROVIDERS = ['google', 'groq', 'ollama'] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

/** API key variable each hosted provider needs. Ollama runs locally and needs none. */
const PROVIDER_API_KEY_VARIABLE: Partial<Record<ModelProvider, 'GOOGLE_GENERATIVE_AI_API_KEY' | 'GROQ_API_KEY'>> = {
    google: 'GOOGLE_GENERATIVE_AI_API_KEY',
    groq: 'GROQ_API_KEY',
};

/** `API_KEYS=claimant:key1,reviewer:key2` → Map of key → role. */
const apiKeys = z
    .string()
    .min(1)
    .transform((raw, ctx) => {
        const keys = new Map<string, Role>();
        for (const entry of raw.split(',')) {
            const [role, key] = entry.split(':').map((part) => part?.trim());
            if (!roles.includes(role) || !key) {
                ctx.addIssue({ code: 'custom', message: `Invalid entry "${entry}", expected role:key` });
                return z.NEVER;
            }
            keys.set(key, role as Role);
        }
        return keys;
    });

/** `MODEL=provider:model-id`, e.g. `google:gemini-3.5-flash-lite` → { provider, modelId }. */
const model = z
    .string()
    .regex(new RegExp(`^(${MODEL_PROVIDERS.join('|')}):.+`), `must be <${MODEL_PROVIDERS.join('|')}>:<model-id>`)
    .transform((raw) => {
        const separator = raw.indexOf(':');
        return { provider: raw.slice(0, separator) as ModelProvider, modelId: raw.slice(separator + 1) };
    });

/**
 * True for a time zone the runtime knows, e.g. "Asia/Kolkata".
 * @param timeZone Candidate IANA time zone.
 */
function isValidTimeZone(timeZone: string): boolean {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone });
        return true;
    } catch {
        return false;
    }
}

/** Comma-separated string → trimmed, non-empty values. */
const csv = z.string().transform((raw) =>
    raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
);

const envSchema = z
    .object({
        NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
        PORT: z.coerce.number().int().positive().default(3000),
        MONGO_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, 'must be a mongodb:// or mongodb+srv:// URI'),
        API_KEYS: apiKeys,
        HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
        HTTP_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
        CORS_ORIGINS: csv.prefault('http://localhost:5173'),
        MODEL: model.prefault('google:gemini-3.5-flash-lite'),
        GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
        GROQ_API_KEY: z.string().optional(),
        OLLAMA_BASE_URL: z.url().default('http://localhost:11434/api'),
        /** Time zone used for "today" and claim submission dates (claimants are in India). */
        CLAIMANT_TIMEZONE: z
            .string()
            .refine(isValidTimeZone, 'must be an IANA time zone, e.g. Asia/Kolkata')
            .default('Asia/Kolkata'),
        /** `fixtures`: recorded flights (default, deterministic). `live`: AeroDataBox via RapidAPI. */
        FLIGHT_DATA_MODE: z.enum(['fixtures', 'live']).default('fixtures'),
        AERODATABOX_API_KEY: z.string().optional(),
        AERODATABOX_HOST: z.string().default('aerodatabox.p.rapidapi.com'),
    })
    .superRefine((env, ctx) => {
        if (env.FLIGHT_DATA_MODE === 'live' && !env.AERODATABOX_API_KEY) {
            ctx.addIssue({
                code: 'custom',
                path: ['AERODATABOX_API_KEY'],
                message: 'required when FLIGHT_DATA_MODE=live',
            });
        }
        const keyVariable = PROVIDER_API_KEY_VARIABLE[env.MODEL.provider];
        if (keyVariable && !env[keyVariable]) {
            ctx.addIssue({
                code: 'custom',
                path: [keyVariable],
                message: `required when MODEL uses ${env.MODEL.provider}`,
            });
        }
    });

export type EnvConfig = z.infer<typeof envSchema>;

/** Passed to `ConfigModule.forRoot({ validate })`: fails at boot listing every invalid variable. */
export function validateEnv(raw: Record<string, unknown>): EnvConfig {
    const result = envSchema.safeParse(raw);
    if (!result.success) {
        const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
        throw new Error(`Invalid environment configuration:\n${issues}`);
    }
    return result.data;
}
