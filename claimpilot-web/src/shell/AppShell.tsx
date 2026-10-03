import { Outlet, useMatches } from 'react-router';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import styles from './AppShell.module.css';

/** Per-route metadata read by the shell. */
export interface RouteHandle {
    title: string;
}

/** Layout route: sidebar + top bar around the active page. The title comes from the route handle. */
export function AppShell() {
    const title = (useMatches().at(-1)?.handle as RouteHandle | undefined)?.title ?? 'ClaimPilot';

    return (
        <div className={styles.shell}>
            <Sidebar />
            <div className={styles.main}>
                <TopBar title={title} />
                <main className={styles.content}>
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
