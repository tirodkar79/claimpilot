import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { roleStore } from '../auth/role.store';
import { decideReview, listReviews, type ReviewItem } from './reviews.api';
import { ReviewQueuePage } from './ReviewQueuePage';

vi.mock('./reviews.api', () => ({ listReviews: vi.fn(), decideReview: vi.fn() }));

const item: ReviewItem = {
    claimId: '6ac0aaaaaaaaaaaaaa263799',
    customerId: 'C-3001',
    policyId: 'P-60',
    flightNumber: '6E2134',
    flightDate: '2026-09-30',
    referralReasons: ['The delay qualifies, but integrity checks raised questions a person should review:'],
    integrityFlags: ['late_purchase'],
    evidencedDelayMinutes: 230,
    qualifyingPayout: { amount: 2000, currency: 'INR' },
    payoutOptions: [
        { amount: 2000, currency: 'INR', minDelayMinutes: 120 },
        { amount: 5000, currency: 'INR', minDelayMinutes: 240 },
    ],
    review: { status: 'pending' },
    createdAt: '2026-10-02T10:00:00Z',
};

/** Renders the page in a router with a fresh query client. */
function renderPage() {
    const router = createMemoryRouter([{ path: '/', element: <ReviewQueuePage /> }]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <RouterProvider router={router} />
        </QueryClientProvider>,
    );
}

describe('ReviewQueuePage', () => {
    afterEach(() => roleStore.set('claimant'));

    it('tells a claimant the queue is for reviewers, without calling the API', () => {
        roleStore.set('claimant');
        renderPage();
        expect(screen.getByText(/Switch to Reviewer/)).toBeInTheDocument();
        expect(listReviews).not.toHaveBeenCalled();
    });

    it('lists referrals with why they were referred and what approval would pay', async () => {
        roleStore.set('reviewer');
        vi.mocked(listReviews).mockResolvedValue({ items: [item], total: 1, page: 1, limit: 50 });
        renderPage();

        expect(await screen.findByText('late purchase')).toBeInTheDocument();
        expect(screen.getByText('3h 50m')).toBeInTheDocument();
        expect(screen.getByText('INR 2,000')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Open full evidence/ })).toHaveAttribute(
            'href',
            `/claims/${item.claimId}`,
        );
    });

    it('records an approval with the chosen tier and a note', async () => {
        roleStore.set('reviewer');
        vi.mocked(listReviews).mockResolvedValue({ items: [item], total: 1, page: 1, limit: 50 });
        vi.mocked(decideReview).mockResolvedValue({ ...item, review: { status: 'resolved', decision: 'APPROVE' } });
        renderPage();

        await screen.findByText('late purchase');
        const submit = screen.getByRole('button', { name: 'Record decision' });
        expect(submit).toBeDisabled(); // a note is required

        await userEvent.selectOptions(screen.getByRole('combobox'), '5000');
        await userEvent.type(screen.getByRole('textbox'), 'Renewal bought late by mistake.');
        await userEvent.click(submit);

        expect(decideReview).toHaveBeenCalledWith(item.claimId, {
            decision: 'APPROVE',
            note: 'Renewal bought late by mistake.',
            payoutAmount: 5000,
        });
    });

    it('sends no payout when rejecting', async () => {
        roleStore.set('reviewer');
        vi.mocked(listReviews).mockResolvedValue({ items: [item], total: 1, page: 1, limit: 50 });
        vi.mocked(decideReview).mockResolvedValue(item);
        renderPage();

        await screen.findByText('late purchase');
        await userEvent.click(screen.getByRole('radio', { name: 'Reject' }));
        await userEvent.type(screen.getByRole('textbox'), 'Bought after the delay was known.');
        await userEvent.click(screen.getByRole('button', { name: 'Record decision' }));

        expect(decideReview).toHaveBeenLastCalledWith(item.claimId, {
            decision: 'REJECT',
            note: 'Bought after the delay was known.',
        });
    });
});
