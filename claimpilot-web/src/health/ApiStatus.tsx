import { useHealth } from './use-health';
import styles from './ApiStatus.module.css';

const LABELS = { pending: 'API · checking', error: 'API · offline', success: 'API · online' } as const;

/** Sidebar footer row: a status dot plus label, so the state is never conveyed by colour alone. */
export function ApiStatus() {
    const { status, error } = useHealth();

    return (
        <div className={styles.row} title={error?.message} role="status">
            <span className={`${styles.dot} ${styles[status]}`} aria-hidden="true" />
            {LABELS[status]}
        </div>
    );
}
