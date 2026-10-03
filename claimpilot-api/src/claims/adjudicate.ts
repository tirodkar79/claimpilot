import type { Policy } from '../policies/policy.schema';
import type { ClaimFacts } from './claim-facts';
import type { ClaimOutcome, ClauseCitation } from './claims.constants';

export interface AdjudicationInput {
    facts: ClaimFacts;
    /** Null when no policy exists with the claimed id. */
    policy: Policy | null;
    policyId: string;
    customerId: string;
    /** Date the claim was submitted (YYYY-MM-DD). */
    submittedOn: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Rules engine, v1: decides from evidence only, never from model output. Checks run in order and the
 * first failing check decides. Later phases add delay tiers, exclusions and integrity checks.
 *
 * 1. Policy exists → else NEED_INFO (likely a typo; ask, don't reject).
 * 2. Policy belongs to the customer → else REFER (could be fraud or a data error; a human decides).
 * 3. Flight date within the cover period → else REJECT (clause: coverage period).
 * 4. Claim within the deadline → else REJECT (clause: claim deadline).
 * 5. Otherwise PENDING until flight evidence is available.
 *
 * @param input Facts, policy and claim metadata. `facts.flightDate` must already be present.
 */
export function adjudicate({ facts, policy, policyId, customerId, submittedOn }: AdjudicationInput): ClaimOutcome {
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

    const flightDate = facts.flightDate as string;
    const cite = (clauseId: string): ClauseCitation[] => {
        const clause = policy.clauses.find((c) => c.id === clauseId);
        return clause ? [{ clauseId: clause.id, title: clause.title }] : [];
    };

    if (flightDate < policy.coverageStart || flightDate > policy.coverageEnd) {
        return {
            decision: 'REJECT',
            reasons: [
                `The flight on ${flightDate} is outside the cover period of policy ${policy.policyId} ` +
                    `(${policy.coverageStart} to ${policy.coverageEnd}).`,
            ],
            citations: cite(policy.clauseRefs.coveragePeriod),
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
            citations: cite(policy.clauseRefs.claimDeadline),
        };
    }

    return {
        decision: 'PENDING',
        reasons: [
            `Policy ${policy.policyId} (${policy.product}) covers this flight and the claim is within the ` +
                `${policy.claimDeadlineDays}-day deadline.`,
            'Flight evidence checks are not connected yet.',
        ],
        citations: [...cite(policy.clauseRefs.coveragePeriod), ...cite(policy.clauseRefs.claimDeadline)],
    };
}
