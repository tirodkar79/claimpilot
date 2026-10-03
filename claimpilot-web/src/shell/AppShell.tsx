import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import styles from './AppShell.module.css';

interface AppShellProps {
    /** Page title shown in the top bar. */
    title: string;
    children: ReactNode;
}

/** Sidebar + top bar frame shared by every page. */
export function AppShell({ title, children }: AppShellProps) {
    return (
        <div className={styles.shell}>
            <Sidebar />
            <div className={styles.main}>
                <TopBar title={title} />
                <main className={styles.content}>{children}</main>
            </div>
        </div>
    );
}
