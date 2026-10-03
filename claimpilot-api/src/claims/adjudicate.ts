import type { FlightFindings } from '../agents/flight.agent';
import type { PolicyFindings } from '../agents/policy.agent';
import { computeDelay } from '../flights/flight-delay';
import type { Policy } from '../policies/policy.schema';
import type { ClaimFacts } from './claim-facts';
import type { ClaimOutcome, ClauseCitation } from './claims.constants';

export interface AdjudicationInput {
    facts: ClaimFacts;
    /** Null when no policy exists with the claimed id. */
    policy: Policy | null;
    policyId: string;
    customerId: string;
    /** Date the claim was submitted (YYYY-MM-DD, claimant's time zone). */
    submittedOn: string;
    policyFindings?: PolicyFindings;
    flight?: FlightFindings;
}

/** Exclusions that need weather or industrial-action evidence, which no agent checks yet. */
const EXCLUSIONS_NEEDING_EVIDENCE = new Set(['severe_weather', 'industrial_action']);
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Formats minutes as "3h 50m".
 * @param minutes Minutes.
 */
function duration(minutes: number): string {
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/**
 * Rules engine, v2: decides from evidence only, never from model output. Checks run in order and the first
 * failing check decides.
 *
 * 1. Policy exists → else NEED_INFO (likely a typo; ask, don't reject).
 * 2. Policy belongs to the customer → else REFER (fraud or data error; a human decides).
 * 3. Flight date within the cover period → else REJECT (clause: coverage period).
 * 4. Claim within the deadline → else REJECT (clause: claim deadline).
 * 5. Flight record found → else NEED_INFO (ask the claimant to confirm number and date; never guess).
 * 6. Flight cancelled → REFER (the policy has no cancellation benefit to apply).
 * 7. Actual time known → else REFER.
 * 8. Delay, measured the policy's way, reaches a payout tier → else REJECT (clauses: measure, tiers).
 * 9. No exclusion flagged that needs evidence we can't check yet → else REFER.
 * 10. APPROVE the tier the evidence reaches, which may be lower than the one claimed.
 *
 * @param input Facts, policy, evidence and claim metadata. `facts.flightDate` must be present.
 */
export function adjudicate(input: AdjudicationInput): ClaimOutcome {
    const { facts, policy, policyId, customerId, submittedOn, policyFindings, flight } = input;
    if (!policy) {
        return {
            decision: 'NEED_INFO',
            reasons: [`We couldn't find policy ${policyId}. Please check the policy number.`],
            citations: [],
        };
    }
    if (policy.holderCustomerId !== customerId) {
        return {
            decision: 'REFER',
            reasons: [`Policy ${policy.policyId} is not held by customer ${customerId}. A person will review it.`],
            citations: [],
        };
    }

    const cite = (...clauseIds: string[]): ClauseCitation[] =>
        clauseIds.flatMap((clauseId) => {
            const clause = policy.clauses.find((c) => c.id === clauseId);
            return clause ? [{ clauseId: clause.id, title: clause.title }] : [];
        });
    const refs = policy.clauseRefs;
    const flightDate = facts.flightDate as string;

    if (flightDate < policy.coverageStart || flightDate > policy.coverageEnd) {
        return {
            decision: 'REJECT',
            reasons: [
                `The flight on ${flightDate} is outside the cover period of policy ${policy.policyId} ` +
                    `(${policy.coverageStart} to ${policy.coverageEnd}).`,
            ],
            citations: cite(refs.coveragePeriod),
        };
    }

    const daysSinceFlight = Math.floor((Date.parse(submittedOn) - Date.parse(flightDate)) / DAY_MS);
    if (daysSinceFlight > policy.claimDeadlineDays) {
        return {
            decision: 'REJECT',
            reasons: [
                `The claim was submitted ${daysSinceFlight} days after the flight; ` +
                    `policy ${policy.policyId} requires claims within ${policy.claimDeadlineDays} days.`,
            ],
            citations: cite(refs.claimDeadline),
        };
    }

    if (!flight?.leg) {
        const route = facts.origin && facts.destination ? ' from ' + facts.origin + ' to ' + facts.destination : '';
        return {
            decision: 'NEED_INFO',
            reasons: [
                `We couldn't find flight ${facts.flightNumber} on ${flightDate}${route}. ` +
                    'Please confirm the flight number and date.',
            ],
            citations: [],
        };
    }

    const delay = computeDelay(flight.leg, policy.delayMeasure);
    if (delay.cancelled) {
        return {
            decision: 'REFER',
            reasons: [`Flight ${flight.flightNumber} was cancelled. Cancellations are reviewed by a person.`],
            citations: [],
        };
    }
    if (delay.minutes === null) {
        return {
            decision: 'REFER',
            reasons: [`The actual ${policy.delayMeasure} time of ${flight.flightNumber} isn't recorded yet.`],
            citations: [],
        };
    }

    const evidenced = Math.max(0, delay.minutes);
    const tier = [...policy.payoutTiers]
        .sort((a, b) => b.minDelayMinutes - a.minDelayMinutes)
        .find((candidate) => evidenced >= candidate.minDelayMinutes);
    const article = policy.delayMeasure === 'arrival' ? 'an' : 'a';
    const measured = `${policy.delayMeasure} delay of ${duration(evidenced)}`;
    if (!tier) {
        const lowest = Math.min(...policy.payoutTiers.map((t) => t.minDelayMinutes));
        return {
            decision: 'REJECT',
            reasons: [
                `The flight record shows ${article} ${measured}, below the ${duration(lowest)} needed for a payout.`,
                ...claimedVersusEvidenced(facts, evidenced, policy),
            ],
            citations: cite(refs.delayMeasure, refs.payoutTiers),
            evidencedDelayMinutes: evidenced,
        };
    }

    const pending = (policyFindings?.relevantExclusions ?? []).filter((e) => EXCLUSIONS_NEEDING_EVIDENCE.has(e.type));
    if (pending.length) {
        const clauses = pending.map((e) => '§' + e.clauseId).join(', ');
        return {
            decision: 'REFER',
            reasons: [
                `The ${measured} qualifies for ${tier.currency} ${tier.amount.toLocaleString('en-IN')}, but ` +
                    `exclusion ${clauses} could apply and needs evidence that isn’t checked automatically yet.`,
            ],
            citations: cite(...pending.map((e) => e.clauseId)),
            evidencedDelayMinutes: evidenced,
        };
    }

    return {
        decision: 'APPROVE',
        reasons: [
            `The flight record shows ${article} ${measured}, which meets the ${duration(tier.minDelayMinutes)} tier.`,
            ...claimedVersusEvidenced(facts, evidenced, policy),
        ],
        citations: cite(refs.delayMeasure, refs.payoutTiers),
        payout: { amount: tier.amount, currency: tier.currency, minDelayMinutes: tier.minDelayMinutes },
        evidencedDelayMinutes: evidenced,
    };
}

/** Gap between claimed and recorded delay worth mentioning even when both land in the same tier. */
const NOTABLE_GAP_MINUTES = 30;

/**
 * Explains a gap between the claimed and the recorded delay when it changes the tier or is large,
 * so the payout basis is clear.
 * @param facts Claim facts.
 * @param evidenced Recorded delay in minutes.
 * @param policy Policy with the payout tiers.
 */
function claimedVersusEvidenced(facts: ClaimFacts, evidenced: number, policy: Policy): string[] {
    const claimed = facts.claimedDelayMinutes;
    if (!claimed) return [];
    const tierOf = (minutes: number) => policy.payoutTiers.filter((t) => minutes >= t.minDelayMinutes).length;
    const changesTier = tierOf(claimed) !== tierOf(evidenced);
    if (!changesTier && Math.abs(claimed - evidenced) < NOTABLE_GAP_MINUTES) return [];
    return [`The claimant reported ${duration(claimed)}; the payout follows the flight record.`];
}
