import { Injectable } from '@nestjs/common';
import { BookingsRepository } from '../bookings/bookings.repository';
import type { ClaimFacts } from '../claims/claim-facts';
import type { Claim } from '../claims/claim.schema';
import { ClaimsRepository } from '../claims/claims.repository';
import type { FlightLeg } from '../flights/flight.types';
import type { Policy } from '../policies/policy.schema';
import type { TraceRecorder } from '../trace/trace.service';

export const INTEGRITY_FLAGS = [
    'duplicate_paid',
    'duplicate_open',
    'late_purchase',
    'booking_not_found',
    'not_on_booking',
    'booking_flight_mismatch',
] as const;
export type IntegrityFlagCode = (typeof INTEGRITY_FLAGS)[number];

export interface IntegrityFlag {
    code: IntegrityFlagCode;
    /** Plain-language explanation for the reviewer. */
    detail: string;
    /** Policy clause the flag relates to, when there is one. */
    clauseId?: string;
}

export interface IntegrityFindings {
    flags: IntegrityFlag[];
    /** What was checked, so a clean result is visibly a checked result. */
    checked: {
        duplicates: number;
        booking: 'matched' | 'not_given' | 'problem';
        purchase: 'before_departure' | 'after_departure' | 'not_checked';
    };
}

/** Clause about delays already known when the policy was bought. */
const KNOWN_BEFORE_PURCHASE_CLAUSE = '7.1';

/**
 * Integrity checks before any payout: duplicate claims, policy bought after the flight was due to leave, and
 * whether the claimant is on the booking quoted. Plain code, not an agent: each rule is a lookup and a
 * comparison, so a model would add cost and quota use without adding judgement.
 */
@Injectable()
export class IntegrityService {
    constructor(
        private readonly claims: ClaimsRepository,
        private readonly bookings: BookingsRepository,
    ) {}

    /**
     * Runs all checks and traces the result.
     * @param claim Claim being triaged.
     * @param facts Claim facts (flight number and date present).
     * @param policy Policy the claim is under.
     * @param leg Matched flight leg, when found.
     * @param recorder Trace recorder of the current run.
     */
    async check(
        claim: Claim,
        facts: ClaimFacts,
        policy: Policy,
        leg: FlightLeg | undefined,
        recorder: TraceRecorder,
    ): Promise<IntegrityFindings> {
        const flags: IntegrityFlag[] = [];

        const duplicates = await this.claims.findOtherClaimsForFlight(
            claim.customerId,
            facts.flightNumber as string,
            facts.flightDate as string,
            String(claim._id),
        );
        const paid = duplicates.find((other) => other.outcome?.decision === 'APPROVE');
        const open = duplicates.find((other) => other.status === 'triaging' || other.outcome?.decision === 'REFER');
        if (paid) {
            flags.push({
                code: 'duplicate_paid',
                detail: `Claim ${String(paid._id).slice(-6)} for this flight was already approved.`,
            });
        } else if (open) {
            flags.push({
                code: 'duplicate_open',
                detail: `Claim ${String(open._id).slice(-6)} for this flight is still open.`,
            });
        }

        let purchase: IntegrityFindings['checked']['purchase'] = 'not_checked';
        if (leg) {
            const boughtAfter = policy.purchasedAt.getTime() > Date.parse(leg.scheduledDeparture);
            purchase = boughtAfter ? 'after_departure' : 'before_departure';
            if (boughtAfter) {
                flags.push({
                    code: 'late_purchase',
                    detail: `Policy ${policy.policyId} was bought after the flight was due to depart.`,
                    clauseId: policy.clauses.some((c) => c.id === KNOWN_BEFORE_PURCHASE_CLAUSE)
                        ? KNOWN_BEFORE_PURCHASE_CLAUSE
                        : undefined,
                });
            }
        }

        const bookingFlags = await this.checkBooking(claim, facts);
        flags.push(...bookingFlags);
        let booking: IntegrityFindings['checked']['booking'] = 'not_given';
        if (claim.bookingRef) booking = bookingFlags.length ? 'problem' : 'matched';

        const findings: IntegrityFindings = { flags, checked: { duplicates: duplicates.length, booking, purchase } };
        await recorder.record(
            'integrity',
            'checks.completed',
            flags.length ? `Integrity flags: ${flags.map((f) => f.code).join(', ')}` : 'No integrity flags',
            { data: { findings } },
        );
        return findings;
    }

    /**
     * Booking checks, when the claimant quoted a booking reference.
     * @param claim Claim being triaged.
     * @param facts Claim facts.
     */
    private async checkBooking(claim: Claim, facts: ClaimFacts): Promise<IntegrityFlag[]> {
        if (!claim.bookingRef) return [];
        const booking = await this.bookings.findByRef(claim.bookingRef);
        if (!booking) return [{ code: 'booking_not_found', detail: `No booking ${claim.bookingRef} exists.` }];

        const flags: IntegrityFlag[] = [];
        if (!booking.passengerCustomerIds.includes(claim.customerId)) {
            flags.push({
                code: 'not_on_booking',
                detail: `Customer ${claim.customerId} is not a passenger on ${booking.bookingRef}.`,
            });
        }
        if (booking.flightNumber !== facts.flightNumber) {
            flags.push({
                code: 'booking_flight_mismatch',
                detail: `Booking ${booking.bookingRef} is for ${booking.flightNumber}, not ${facts.flightNumber}.`,
            });
        }
        return flags;
    }
}
