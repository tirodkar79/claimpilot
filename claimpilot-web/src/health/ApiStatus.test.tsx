import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { getHealth } from '../api/health.api';
import { ApiError } from '../api/api-error';
import { ApiStatus } from './ApiStatus';

vi.mock('../api/health.api', () => ({ getHealth: vi.fn() }));

/** Renders the status row with a fresh query client. */
function renderStatus() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ApiStatus />
        </QueryClientProvider>,
    );
}

describe('ApiStatus', () => {
    it('shows online when the health check succeeds', async () => {
        vi.mocked(getHealth).mockResolvedValue({ status: 'ok', mongo: 'up', uptimeSeconds: 5 });
        renderStatus();
        expect(screen.getByRole('status')).toHaveTextContent('API · checking');
        expect(await screen.findByText('API · online')).toBeInTheDocument();
    });

    it('shows offline with the reason when the health check fails', async () => {
        vi.mocked(getHealth).mockRejectedValue(new ApiError('SERVICE_UNAVAILABLE', 'MongoDB not connected', 503));
        renderStatus();
        expect(await screen.findByText('API · offline')).toHaveAttribute('title', 'MongoDB not connected');
    });
});
