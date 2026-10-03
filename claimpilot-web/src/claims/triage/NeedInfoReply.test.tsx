import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../api/api-error';
import { addClaimDetails, type Claim } from '../claims.api';
import { NeedInfoReply } from './NeedInfoReply';

vi.mock('../claims.api', () => ({ addClaimDetails: vi.fn() }));

/**
 * Renders the form with a fresh query client.
 * @param onSent Callback after a successful send.
 */
function renderReply(onSent = vi.fn()) {
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
            <NeedInfoReply claimId="claim-1" onSent={onSent} />
        </QueryClientProvider>,
    );
    return onSent;
}

describe('NeedInfoReply', () => {
    it('sends the details and lets the page follow the new triage run', async () => {
        vi.mocked(addClaimDetails).mockResolvedValue({ status: 'triaging' } as Claim);
        const onSent = renderReply();

        const send = screen.getByRole('button', { name: 'Send details' });
        expect(send).toBeDisabled();
        await userEvent.type(
            screen.getByRole('textbox', { name: 'Missing details' }),
            '  Flight 6E-2134 on 30 September ',
        );
        await userEvent.click(send);

        expect(addClaimDetails).toHaveBeenCalledWith('claim-1', 'Flight 6E-2134 on 30 September');
        expect(onSent).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('textbox', { name: 'Missing details' })).toHaveValue('');
    });

    it('shows why the details were refused', async () => {
        vi.mocked(addClaimDetails).mockRejectedValue(
            new ApiError('CONFLICT', 'Only a claim that is waiting for more information can take more details', 409),
        );
        const onSent = renderReply();

        await userEvent.type(screen.getByRole('textbox', { name: 'Missing details' }), 'more');
        await userEvent.click(screen.getByRole('button', { name: 'Send details' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('waiting for more information');
        expect(onSent).not.toHaveBeenCalled();
    });
});
