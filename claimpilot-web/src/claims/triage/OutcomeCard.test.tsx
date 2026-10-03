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
                outcome={{
                    decision: 'NEED_INFO',
                    reasons: ['On what date was your flight?', 'How long was it?'],
                    citations: [],
                }}
            />,
        );
        expect(screen.getByText('Need info')).toBeInTheDocument();
        expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
            'On what date was your flight?',
            'How long was it?',
        ]);
    });

    it('labels a referral', () => {
        render(<OutcomeCard outcome={{ decision: 'REFER', reasons: ['A person will review it.'], citations: [] }} />);
        expect(screen.getByText('Referred')).toBeInTheDocument();
    });

    it('stamps a rejection with the clauses it relies on and shows the orchestrator summary', () => {
        render(
            <OutcomeCard
                outcome={{
                    decision: 'REJECT',
                    reasons: ['The flight is outside the cover period.'],
                    citations: [{ clauseId: '2.1', title: 'Period of cover' }],
                }}
                summary="Policy P-12 ended before the flight."
            />,
        );
        expect(screen.getByText('Rejected')).toBeInTheDocument();
        expect(screen.getByText('§2.1 Period of cover')).toBeInTheDocument();
        expect(screen.getByText('Policy P-12 ended before the flight.')).toBeInTheDocument();
    });
});
