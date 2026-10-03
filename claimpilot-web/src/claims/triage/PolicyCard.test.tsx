import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PolicyFindings } from '../claims.api';
import { PolicyCard } from './PolicyCard';

const findings: PolicyFindings = {
    policyId: 'P-77',
    delayMeasure: 'departure',
    relevantExclusions: [{ type: 'severe_weather', clauseId: '7.3', summary: 'Fog delays are excluded.' }],
    summary: 'Fog could trigger the weather exclusion.',
    citedClauses: [{ id: '7.3', title: 'Severe weather', text: 'We do not pay for a delay caused by severe weather.' }],
    droppedCitations: [],
    delayMeasureMismatch: false,
};

describe('PolicyCard', () => {
    it('waits for the Policy agent', () => {
        render(<PolicyCard policyId="P-77" />);
        expect(screen.getByText('not read yet')).toBeInTheDocument();
    });

    it('shows flagged exclusions and reveals the cited clause text on demand', async () => {
        render(<PolicyCard policyId="P-77" findings={findings} />);

        expect(screen.getByText('from departure')).toBeInTheDocument();
        expect(screen.getByText('Severe weather', { selector: 'b' })).toBeInTheDocument();

        const clauseText = screen.getByText('We do not pay for a delay caused by severe weather.');
        expect(clauseText).not.toBeVisible();
        await userEvent.click(screen.getByText('Severe weather', { selector: 'summary *, summary' }));
        expect(clauseText).toBeVisible();
    });

    it('surfaces grounding problems instead of hiding them', () => {
        render(
            <PolicyCard
                policyId="P-77"
                findings={{ ...findings, droppedCitations: ['12.9'], delayMeasureMismatch: true }}
            />,
        );
        const warning = screen.getByRole('status');
        expect(warning).toHaveTextContent("clauses that don't exist: 12.9");
        expect(warning).toHaveTextContent('misread how delay is measured');
    });
});
