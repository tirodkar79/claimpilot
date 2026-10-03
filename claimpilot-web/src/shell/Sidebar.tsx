import { BarChart3, Inbox, Plus, ShieldCheck } from 'lucide-react';
import { NavLink } from 'react-router';
import { roleStore } from '../auth/role.store';
import { ApiStatus } from '../health/ApiStatus';
import { usePersistedStore } from '../lib/persisted-store';
import styles from './AppShell.module.css';

/** Brand, navigation and system status. The review queue and evaluations appear for reviewers only. */
export function Sidebar() {
    const [role] = usePersistedStore(roleStore);
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
                {role === 'reviewer' && (
                    <>
                        <NavLink to="/reviews" className={styles.navItem}>
                            <Inbox size={16} strokeWidth={1.8} />
                            Review queue
                        </NavLink>
                        <NavLink to="/evals" className={styles.navItem}>
                            <BarChart3 size={16} strokeWidth={1.8} />
                            Evaluations
                        </NavLink>
                    </>
                )}
            </nav>

            <footer className={styles.sidebarFooter}>
                <ApiStatus />
            </footer>
        </aside>
    );
}
