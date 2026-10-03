import { Types } from 'mongoose';
import type { Booking } from '../bookings/booking.schema';
import type { BookingsRepository } from '../bookings/bookings.repository';
import { BOOKING_SEEDS } from '../bookings/bookings.seed';
import type { ClaimFacts } from '../claims/claim-facts';
import type { Claim } from '../claims/claim.schema';
import type { ClaimsRepository } from '../claims/claims.repository';
import { recordedLegs } from '../flights/recorded-flights';
import { POLICY_SEEDS } from '../policies/policies.seed';
import type { Policy } from '../policies/policy.schema';
import type { TraceRecorder } from '../trace/trace.service';
import { IntegrityService } from './integrity.service';

const standard = POLICY_SEEDS.find((p) => p.policyId === 'P-77') as Policy; // bought 2026-05-20
const [leg] = recordedLegs('6E2134', '2026-09-24');
const facts = { flightNumber: '6E2134', flightDate: '2026-09-24' } as ClaimFacts;
const claim = { _id: new Types.ObjectId(), customerId: 'C-1042', bookingRef: 'XK9P2L' } as Claim;

/**
 * Builds the service over in-memory claims and the seed bookings.
 * @param others Other claims for the same flight.
 */
function setup(others: Partial<Claim>[] = []) {
    const events: string[] = [];
    const claims = {
        findOtherClaimsForFlight: jest.fn().mockResolvedValue(others.map((o) => ({ _id: new Types.ObjectId(), ...o }))),
    };
    const bookings = {
        findByRef: async (ref: string) =>
            (BOOKING_SEEDS.find((b) => b.bookingRef === ref.toUpperCase()) as Booking) ?? null,
    };
    const service = new IntegrityService(
        claims as unknown as ClaimsRepository,
        bookings as unknown as BookingsRepository,
    );
    return { service, events, claims };
}

describe('IntegrityService', () => {
    it('passes a clean claim, says what was checked and traces the result', async () => {
        const { service, events, claims } = setup();
        const recorder: TraceRecorder = {
            record: async (_actor, type, message) => {
                events.push(`${type}:${message}`);
                return {} as never;
            },
        };

        const findings = await service.check(claim, facts, standard, leg, recorder);

        expect(findings).toEqual({
            flags: [],
            checked: { duplicates: 0, booking: 'matched', purchase: 'before_departure' },
        });
        expect(claims.findOtherClaimsForFlight).toHaveBeenCalledWith(
            'C-1042',
            '6E2134',
            '2026-09-24',
            String(claim._id),
        );
        expect(events).toEqual(['checks.completed:No integrity flags']);
    });

    it.each([
        ['an approved claim', { outcome: { decision: 'APPROVE', reasons: [], citations: [] } }, 'duplicate_paid'],
        ['a claim still being triaged', { status: 'triaging' }, 'duplicate_open'],
        [
            'a referred claim',
            { status: 'completed', outcome: { decision: 'REFER', reasons: [], citations: [] } },
            'duplicate_open',
        ],
    ] as const)('flags a duplicate of %s', async (_label, other, code) => {
        const { service } = setup([other as Partial<Claim>]);
        const { flags } = await service.check(claim, facts, standard, leg, { record: jest.fn() });
        expect(flags.map((f) => f.code)).toEqual([code]);
    });

    it('ignores earlier claims that were rejected or needed info', async () => {
        const { service } = setup([
            { status: 'completed', outcome: { decision: 'REJECT', reasons: [], citations: [] } },
        ]);
        expect((await service.check(claim, facts, standard, leg, { record: jest.fn() })).flags).toEqual([]);
    });

    it('flags a policy bought after the flight was due to depart, citing clause 7.1', async () => {
        const lateBuyer = { ...standard, purchasedAt: new Date('2026-09-25T00:00:00Z') };
        const { service } = setup();
        const findings = await service.check(claim, facts, lateBuyer, leg, { record: jest.fn() });
        expect(findings.flags).toEqual([expect.objectContaining({ code: 'late_purchase', clauseId: '7.1' })]);
        expect(findings.checked.purchase).toBe('after_departure');
    });

    it('skips the purchase check when no flight leg was found', async () => {
        const { service } = setup();
        expect((await service.check(claim, facts, standard, undefined, { record: jest.fn() })).checked.purchase).toBe(
            'not_checked',
        );
    });

    it.each([
        ['an unknown booking', 'NOPE01', ['booking_not_found']],
        ['someone else’s booking for another flight', 'ZZ9999', ['not_on_booking', 'booking_flight_mismatch']],
    ])('flags %s', async (_label, bookingRef, codes) => {
        const { service } = setup();
        const { flags, checked } = await service.check({ ...claim, bookingRef } as Claim, facts, standard, leg, {
            record: jest.fn(),
        });
        expect(flags.map((f) => f.code)).toEqual(codes);
        expect(checked.booking).toBe('problem');
    });

    it('does not check a booking the claimant did not quote', async () => {
        const { service } = setup();
        const findings = await service.check({ ...claim, bookingRef: undefined } as Claim, facts, standard, leg, {
            record: jest.fn(),
        });
        expect(findings).toMatchObject({ flags: [], checked: { booking: 'not_given' } });
    });
});
