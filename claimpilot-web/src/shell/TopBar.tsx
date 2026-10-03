import { RoleSwitch } from '../auth/RoleSwitch';
import { ThemeToggle } from '../theme/ThemeToggle';
import styles from './AppShell.module.css';

interface TopBarProps {
    title: string;
}

/** Page title on the left; role and theme controls on the right. */
export function TopBar({ title }: TopBarProps) {
    return (
        <header className={styles.topBar}>
            <h1 className={styles.title}>{title}</h1>
            <div className={styles.topBarActions}>
                <RoleSwitch />
                <ThemeToggle />
            </div>
        </header>
    );
}
