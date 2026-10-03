import { render, screen } from '@testing-library/react';
import type { FlightFindings } from '../claims.api';
import { FlightCard } from './FlightCard';

const findings: FlightFindings = {
    flightNumber: '6E2134',
    claimedDate: '2026-09-22',
    leg: {
        flightNumber: '6E2134',
        status: 'landed',
        origin: { iata: 'BOM', timeZone: 'Asia/Kolkata' },
        destination: { iata: 'DEL', timeZone: 'Asia/Kolkata' },
        scheduledDeparture: '2026-09-22T13:10:00.000Z',
        actualDeparture: '2026-09-22T17:00:00.000Z',
        scheduledArrival: '2026-09-22T15:20:00.000Z',
        actualArrival: '2026-09-22T18:55:00.000Z',
    },
    source: 'recorded',
    selectedBy: 'agent',
    notes: 'Found.',
    lookups: [{ date: '2026-09-22', legs: 1 }],
};

describe('FlightCard', () => {
    it('shows local scheduled and actual times and the source', () => {
        render(<FlightCard findings={findings} measure="departure" claimedMinutes={240} />);
        expect(screen.getByText('recorded data')).toBeInTheDocument();
        expect(screen.getByText(/22 Sept?, 18:40 → 22 Sept?, 22:30/)).toBeInTheDocument();
    });

    it('draws claimed and recorded delay for the measure the policy uses', () => {
        const { rerender } = render(
            <FlightCard findings={findings} measure="departure" claimedMinutes={240} outcome={undefined} />,
        );
        expect(screen.getByRole('img')).toHaveAccessibleName(
            'Scheduled departure 18:40; actual 22:30, 230 minutes late; claimant said 240 minutes',
        );

        rerender(<FlightCard findings={findings} measure="arrival" claimedMinutes={240} />);
        expect(screen.getByRole('img')).toHaveAccessibleName(
            'Scheduled arrival 20:50; actual 00:25, 215 minutes late; claimant said 240 minutes',
        );
    });

    it('says when no record was found, including the extra date checked', () => {
        render(
            <FlightCard
                findings={{
                    ...findings,
                    leg: undefined,
                    source: undefined,
                    lookups: [
                        { date: '2026-09-22', legs: 0 },
                        { date: '2026-09-23', legs: 0 },
                    ],
                }}
            />,
        );
        expect(screen.getByText('No record of 6E2134 on 2026-09-22 (also checked 2026-09-23).')).toBeInTheDocument();
    });
});
