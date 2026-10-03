import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ApiError } from '../api/api-error';
import { createClaim } from './claims.api';
import { NewClaimPage } from './NewClaimPage';

vi.mock('./claims.api', () => ({ createClaim: vi.fn() }));

/** Renders the form inside a memory router; the claim route shows its id so navigation is visible. */
function renderPage() {
    const router = createMemoryRouter(
        [
            { path: '/', element: <NewClaimPage /> },
            { path: '/claims/:claimId', element: <p>claim page</p> },
        ],
        { initialEntries: ['/'] },
    );
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <RouterProvider router={router} />
        </QueryClientProvider>,
    );
    return router;
}

describe('NewClaimPage', () => {
    it('submits an example claim and opens its triage view', async () => {
        vi.mocked(createClaim).mockResolvedValue({ id: 'abc123' } as never);
        const router = renderPage();

        await userEvent.click(screen.getByRole('button', { name: 'Delay payout' }));
        await userEvent.click(screen.getByRole('button', { name: /Run triage/ }));

        expect(await screen.findByText('claim page')).toBeInTheDocument();
        expect(router.state.location.pathname).toBe('/claims/abc123');
        expect(vi.mocked(createClaim).mock.calls[0][0]).toMatchObject({
            customerId: 'C-1042',
            policyId: 'P-77',
            bookingRef: 'XK9P2L',
        });
    });

    it('drops an empty booking reference', async () => {
        vi.mocked(createClaim).mockResolvedValue({ id: 'abc123' } as never);
        renderPage();

        await userEvent.click(screen.getByRole('button', { name: 'Missing details' }));
        await userEvent.click(screen.getByRole('button', { name: /Run triage/ }));

        await screen.findByText('claim page');
        expect(vi.mocked(createClaim).mock.calls.at(-1)?.[0].bookingRef).toBeUndefined();
    });

    it('shows the API error and each invalid field', async () => {
        vi.mocked(createClaim).mockRejectedValue(
            new ApiError('BAD_REQUEST', 'Validation failed', 400, 'req-1', [
                { path: 'message', message: 'Too small: expected string to have >=10 characters' },
            ]),
        );
        renderPage();

        await userEvent.click(screen.getByRole('button', { name: /Run triage/ }));

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Validation failed');
        expect(alert).toHaveTextContent('message: Too small');
    });
});
