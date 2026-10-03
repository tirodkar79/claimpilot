import { createPersistedStore } from '../lib/persisted-store';
import { ROLES, type Role } from './auth.constants';

const ROLE_STORAGE_KEY = 'claimpilot:role';

/**
 * Narrows a stored string to a role.
 * @param value Stored value.
 */
function isRole(value: string): value is Role {
    return (ROLES as readonly string[]).includes(value);
}

/** Which role the UI acts as; the HTTP client sends that role's API key. */
export const roleStore = createPersistedStore<Role>(ROLE_STORAGE_KEY, isRole, () => 'claimant');
