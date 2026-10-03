import { useQueryClient } from '@tanstack/react-query';
import { usePersistedStore } from '../lib/persisted-store';
import { ROLE_LABELS, ROLES, type Role } from './auth.constants';
import { roleStore } from './role.store';
import styles from './RoleSwitch.module.css';

/**
 * Switches which role the UI acts as. Cached queries are refetched under the new role's key (responses may
 * differ per role, e.g. the review queue is reviewer-only), but what's on screen stays until the new data
 * arrives, so switching roles never blanks the page.
 */
export function RoleSwitch() {
    const [role, setRole] = usePersistedStore(roleStore);
    const queryClient = useQueryClient();

    /**
     * Applies the new role and refetches the visible data under its API key.
     * @param next Role to act as.
     */
    const changeRole = (next: Role) => {
        setRole(next);
        void queryClient.invalidateQueries();
    };

    return (
        <div className={styles.switch} role="radiogroup" aria-label="Act as">
            {ROLES.map((option) => (
                <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={role === option}
                    className={styles.option}
                    onClick={() => changeRole(option)}
                >
                    {ROLE_LABELS[option]}
                </button>
            ))}
        </div>
    );
}
