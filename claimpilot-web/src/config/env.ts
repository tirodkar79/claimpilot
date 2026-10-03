import type { Role } from '../auth/auth.constants';

/**
 * Reads a required Vite env variable.
 * @param name Variable name (must start with VITE_).
 * @throws Error naming the variable when it is missing, so a bad setup fails on load.
 */
function required(name: string): string {
    const value = import.meta.env[name] as string | undefined;
    if (!value) throw new Error(`Missing ${name}. Copy .env.example to .env.`);
    return value;
}

export const env = {
    apiUrl: required('VITE_API_URL'),
    apiKeys: {
        claimant: required('VITE_CLAIMANT_API_KEY'),
        reviewer: required('VITE_REVIEWER_API_KEY'),
    } satisfies Record<Role, string>,
} as const;
