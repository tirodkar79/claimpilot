import { z } from 'zod';
import { Role } from '../auth/auth.constants';

const roles = Object.values(Role) as string[];

/** `API_KEYS=claimant:key1,reviewer:key2` → Map of key → role. */
const apiKeys = z
    .string()
    .min(1)
    .transform((raw, ctx) => {
        const keys = new Map<string, Role>();
        for (const entry of raw.split(',')) {
            const [role, key] = entry.split(':').map((part) => part?.trim());
            if (!roles.includes(role) || !key) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `Invalid entry "${entry}", expected role:key`,
                });
                return z.NEVER;
            }
            keys.set(key, role as Role);
        }
        return keys;
    });

/** Comma-separated string → trimmed, non-empty values. */
const csv = z.string().transform((raw) =>
    raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
);

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    MONGO_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, 'must be a mongodb:// or mongodb+srv:// URI'),
    API_KEYS: apiKeys,
    HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
    HTTP_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    CORS_ORIGINS: csv.default('http://localhost:5173'),
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
