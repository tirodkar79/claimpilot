import { LayoutGrid, ShieldCheck } from 'lucide-react';
import { ApiStatus } from '../health/ApiStatus';
import styles from './AppShell.module.css';

/** Brand, navigation and system status. Navigation grows as features ship. */
export function Sidebar() {
    return (
        <aside className={styles.sidebar}>
            <div className={styles.logo}>
                <span className={styles.logoMark}>
                    <ShieldCheck size={18} strokeWidth={1.8} />
                </span>
                <b>
                    Claim<em>Pilot</em>
                </b>
            </div>

            <nav aria-label="Main">
                <a className={styles.navItem} aria-current="page" href="/">
                    <LayoutGrid size={16} strokeWidth={1.8} />
                    Overview
                </a>
            </nav>

            <footer className={styles.sidebarFooter}>
                <ApiStatus />
            </footer>
        </aside>
    );
}
