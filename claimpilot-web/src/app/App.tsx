import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { ClaimsHistoryPage } from '../claims/ClaimsHistoryPage';
import { ClaimTriagePage } from '../claims/ClaimTriagePage';
import { NewClaimPage } from '../claims/NewClaimPage';
import { EvalsPage } from '../evals/EvalsPage';
import { ReviewQueuePage } from '../reviews/ReviewQueuePage';
import { AppShell, type RouteHandle } from '../shell/AppShell';
import { queryClient } from './query-client';

const router = createBrowserRouter([
    {
        element: <AppShell />,
        children: [
            { index: true, element: <NewClaimPage />, handle: { title: 'New claim' } satisfies RouteHandle },
            {
                path: 'claims',
                element: <ClaimsHistoryPage />,
                handle: { title: 'Claims' } satisfies RouteHandle,
            },
            {
                path: 'reviews',
                element: <ReviewQueuePage />,
                handle: { title: 'Review queue' } satisfies RouteHandle,
            },
            {
                path: 'evals',
                element: <EvalsPage />,
                handle: { title: 'Evaluations' } satisfies RouteHandle,
            },
            {
                path: 'claims/:claimId',
                element: <ClaimTriagePage />,
                handle: { title: 'Live triage' } satisfies RouteHandle,
            },
        ],
    },
]);

/** Root component: data and routing providers. */
export function App() {
    return (
        <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
        </QueryClientProvider>
    );
}
