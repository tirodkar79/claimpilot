import { render, screen } from '@testing-library/react';
import { IntegrityCard } from './IntegrityCard';

describe('IntegrityCard', () => {
    it('shows a clean result as checked, not just empty', () => {
        render(
            <IntegrityCard
                findings={{ flags: [], checked: { duplicates: 0, booking: 'matched', purchase: 'before_departure' } }}
            />,
        );
        expect(screen.getByText('no flags')).toBeInTheDocument();
        expect(screen.getByText('claimant on booking')).toBeInTheDocument();
        expect(screen.getByText('bought before departure')).toBeInTheDocument();
    });

    it('lists each flag with its explanation and clause', () => {
        render(
            <IntegrityCard
                findings={{
                    flags: [
                        {
                            code: 'late_purchase',
                            detail: 'Policy P-60 was bought after the flight was due to depart.',
                            clauseId: '7.1',
                        },
                    ],
                    checked: { duplicates: 0, booking: 'matched', purchase: 'after_departure' },
                }}
            />,
        );
        const flag = screen.getByRole('status');
        expect(flag).toHaveTextContent('late purchase');
        expect(flag).toHaveTextContent('bought after the flight was due to depart');
        expect(flag).toHaveTextContent('§7.1');
    });
});
