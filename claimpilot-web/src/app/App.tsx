import { QueryClientProvider } from '@tanstack/react-query';
import { OverviewPage } from '../overview/OverviewPage';
import { AppShell } from '../shell/AppShell';
import { queryClient } from './query-client';

/** Root component: providers plus the shell. Routing arrives with the first feature screen. */
export function App() {
    return (
        <QueryClientProvider client={queryClient}>
            <AppShell title="Overview">
                <OverviewPage />
            </AppShell>
        </QueryClientProvider>
    );
}
