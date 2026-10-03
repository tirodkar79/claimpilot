import { Plus, ShieldCheck } from 'lucide-react';
import { NavLink } from 'react-router';
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
                <NavLink to="/" end className={styles.navItem}>
                    <Plus size={16} strokeWidth={1.8} />
                    New claim
                </NavLink>
            </nav>

            <footer className={styles.sidebarFooter}>
                <ApiStatus />
            </footer>
        </aside>
    );
}
