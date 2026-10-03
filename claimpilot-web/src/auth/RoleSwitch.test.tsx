import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { roleStore } from './role.store';
import { RoleSwitch } from './RoleSwitch';

/** Shows a query's data, so the test can see whether switching roles blanks it. */
function Claim({ load }: { load: () => Promise<string> }) {
    const { data } = useQuery({ queryKey: ['claim'], queryFn: load });
    return <p>{data ?? 'nothing'}</p>;
}

describe('RoleSwitch', () => {
    afterEach(() => roleStore.set('claimant'));

    it('keeps what is on screen while refetching under the new role', async () => {
        let resolveRefetch: (value: string) => void = () => undefined;
        const load = vi
            .fn<() => Promise<string>>()
            .mockResolvedValueOnce('claim as claimant')
            .mockImplementationOnce(() => new Promise((resolve) => (resolveRefetch = resolve)));
        render(
            <QueryClientProvider client={new QueryClient()}>
                <RoleSwitch />
                <Claim load={load} />
            </QueryClientProvider>,
        );
        expect(await screen.findByText('claim as claimant')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('radio', { name: 'Reviewer' }));

        expect(roleStore.get()).toBe('reviewer');
        expect(load).toHaveBeenCalledTimes(2);
        expect(screen.getByText('claim as claimant')).toBeInTheDocument(); // not blanked while refetching
        resolveRefetch('claim as reviewer');
        expect(await screen.findByText('claim as reviewer')).toBeInTheDocument();
    });
});
