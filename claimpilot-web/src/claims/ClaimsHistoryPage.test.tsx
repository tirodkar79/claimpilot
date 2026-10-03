import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { listClaims, type ClaimListItem } from './claims.api';
import { ClaimsHistoryPage } from './ClaimsHistoryPage';

vi.mock('./claims.api', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./claims.api')>()),
    listClaims: vi.fn(),
}));

const base = {
    customerId: 'C-1042',
    policyId: 'P-77',
    flightNumber: '6E2134',
    flightDate: '2026-09-30',
    createdAt: '2026-10-03T06:00:00Z',
};
const claims: ClaimListItem[] = [
    { ...base, id: 'aaaaaaaaaaaaaaaaaa000001', status: 'triaging' },
    {
        ...base,
        id: 'aaaaaaaaaaaaaaaaaa000002',
        status: 'completed',
        decision: 'APPROVE',
        payout: { amount: 2000, currency: 'INR' },
    },
    { ...base, id: 'aaaaaaaaaaaaaaaaaa000003', status: 'completed', decision: 'REFER', reviewStatus: 'pending' },
    {
        ...base,
        id: 'aaaaaaaaaaaaaaaaaa000004',
        status: 'completed',
        decision: 'REFER',
        reviewStatus: 'resolved',
        reviewDecision: 'APPROVE',
        payout: { amount: 5000, currency: 'INR' },
    },
];

/**
 * Renders the page in a router at a URL.
 * @param url Starting URL.
 */
function renderPage(url = '/claims') {
    const router = createMemoryRouter(
        [
            { path: '/claims', element: <ClaimsHistoryPage /> },
            { path: '/claims/:claimId', element: <p>claim page</p> },
        ],
        { initialEntries: [url] },
    );
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <RouterProvider router={router} />
        </QueryClientProvider>,
    );
    return router;
}

describe('ClaimsHistoryPage', () => {
    beforeEach(() => vi.mocked(listClaims).mockResolvedValue({ items: claims, total: 4, page: 1, limit: 25 }));

    it('lists claims with where each one stands', async () => {
        renderPage();

        const rows = await screen.findAllByRole('row');
        expect(rows).toHaveLength(5); // header + 4
        expect(within(rows[1]).getByText('Triaging…')).toBeInTheDocument();
        expect(within(rows[2]).getByText('Approved')).toBeInTheDocument();
        expect(within(rows[2]).getByText('INR 2,000')).toBeInTheDocument();
        expect(within(rows[3]).getByText('Referred · in review')).toBeInTheDocument();
        expect(within(rows[4]).getByText('Approved · reviewed')).toBeInTheDocument();
        expect(within(rows[4]).getByText('INR 5,000')).toBeInTheDocument();
    });

    it('filters by customer from the URL and as you type', async () => {
        renderPage('/claims?customer=C-2077');
        await screen.findAllByRole('row');
        expect(listClaims).toHaveBeenLastCalledWith('C-2077', 1);

        const filter = screen.getByPlaceholderText('All, or e.g. C-1042');
        await userEvent.clear(filter);
        await userEvent.type(filter, 'C-3001');
        expect(listClaims).toHaveBeenLastCalledWith('C-3001', 1);
    });

    it('opens a claim when its row is clicked', async () => {
        const router = renderPage();
        const rows = await screen.findAllByRole('row');
        await userEvent.click(rows[2]);
        expect(router.state.location.pathname).toBe('/claims/aaaaaaaaaaaaaaaaaa000002');
    });

    it('explains an empty history', async () => {
        vi.mocked(listClaims).mockResolvedValue({ items: [], total: 0, page: 1, limit: 25 });
        renderPage('/claims?customer=C-9999');
        expect(await screen.findByText('No claims for C-9999.')).toBeInTheDocument();
    });
});
