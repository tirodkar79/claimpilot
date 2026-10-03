import { render, screen } from '@testing-library/react';
import { ReviewCard } from './ReviewCard';

describe('ReviewCard', () => {
    it('shows a pending review', () => {
        render(<ReviewCard review={{ status: 'pending' }} />);
        expect(screen.getByText('waiting for a reviewer')).toBeInTheDocument();
    });

    it('shows the reviewer decision, payout and note', () => {
        render(
            <ReviewCard
                review={{
                    status: 'resolved',
                    decision: 'APPROVE',
                    payout: { amount: 2000, currency: 'INR' },
                    note: 'Renewal.',
                }}
            />,
        );
        expect(screen.getByText('Approved')).toBeInTheDocument();
        expect(screen.getByText(/INR 2,000/)).toBeInTheDocument();
        expect(screen.getByText('“Renewal.”')).toBeInTheDocument();
    });
});
