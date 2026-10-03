import { render, screen } from '@testing-library/react';
import { OutcomeCard } from './OutcomeCard';

describe('OutcomeCard', () => {
    it('shows progress while triage runs', () => {
        render(<OutcomeCard />);
        expect(screen.getByText('Triage in progress…')).toBeInTheDocument();
    });

    it('lists the questions for NEED_INFO', () => {
        render(
            <OutcomeCard
                outcome={{ decision: 'NEED_INFO', reasons: ['On what date was your flight?', 'How long was it?'] }}
            />,
        );
        expect(screen.getByText('Need info')).toBeInTheDocument();
        expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
            'On what date was your flight?',
            'How long was it?',
        ]);
    });

    it('labels a referral', () => {
        render(<OutcomeCard outcome={{ decision: 'REFER', reasons: ['A person will review it.'] }} />);
        expect(screen.getByText('Referred')).toBeInTheDocument();
    });
});
