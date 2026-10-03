/** Mirrors `Role` in claimpilot-api/src/auth/auth.constants.ts. */
export const ROLES = ['claimant', 'reviewer'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
    claimant: 'Claimant',
    reviewer: 'Reviewer',
};

export const API_KEY_HEADER = 'x-api-key';
