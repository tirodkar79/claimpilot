import type { Policy } from './policy.schema';

type PolicySeed = Omit<Policy, '_id'>;

/** Shared wording for the SkyGuard product family. Fictional, written for this exercise. */
const COMMON_CLAUSES = {
    definitions: {
        id: '1.1',
        title: 'Definitions',
        text:
            '"Scheduled departure" and "scheduled arrival" mean the times on the airline timetable when the ' +
            'ticket was issued. "Actual departure" means the time the aircraft left the gate; "actual arrival" ' +
            'means the time it reached the gate. All times are compared in the same time zone.',
    },
    coveragePeriod: {
        id: '2.1',
        title: 'Period of cover',
        text:
            'We cover flights scheduled to depart on or between the start and end dates shown in the policy ' +
            'schedule. Flights outside this period are not covered.',
    },
    claimDeadline: {
        id: '9.2',
        title: 'Making a claim',
        text:
            'You must submit your claim within the number of days after the scheduled departure date shown in ' +
            'the policy schedule. Claims submitted after this period will not be paid.',
    },
    knownBeforePurchase: {
        id: '7.1',
        title: 'Delays known before you bought the policy',
        text:
            'We do not pay for a delay that had been announced by the airline, or reported in the media, ' +
            'before this policy was purchased.',
    },
};

export const POLICY_SEEDS: PolicySeed[] = [
    {
        policyId: 'P-77',
        product: 'SkyGuard Standard',
        holderCustomerId: 'C-1042',
        coverageStart: '2026-06-01',
        coverageEnd: '2027-05-31',
        purchasedAt: new Date('2026-05-20T10:00:00Z'),
        claimDeadlineDays: 30,
        delayMeasure: 'departure',
        payoutTiers: [
            { minDelayMinutes: 120, amount: 2000, currency: 'INR' },
            { minDelayMinutes: 240, amount: 5000, currency: 'INR' },
            { minDelayMinutes: 360, amount: 10000, currency: 'INR' },
        ],
        clauseRefs: { coveragePeriod: '2.1', claimDeadline: '9.2', delayMeasure: '4.1', payoutTiers: '4.2' },
        clauses: [
            COMMON_CLAUSES.definitions,
            COMMON_CLAUSES.coveragePeriod,
            {
                id: '4.1',
                title: 'How delay is measured',
                text:
                    'Delay is measured as the difference between the scheduled departure and the actual ' +
                    'departure of the flight. Time spent on the ground after boarding counts as delay.',
            },
            {
                id: '4.2',
                title: 'Delay benefit',
                text:
                    'We pay a fixed benefit for the highest band the delay reaches: INR 2,000 for 2 hours or ' +
                    'more, INR 5,000 for 4 hours or more, and INR 10,000 for 6 hours or more.',
            },
            COMMON_CLAUSES.knownBeforePurchase,
            {
                id: '7.3',
                title: 'Severe weather',
                text:
                    'We do not pay for a delay caused by severe weather, including fog that reduces visibility ' +
                    'at the departure or arrival airport below airport operating limits, storms or snow.',
            },
            {
                id: '7.4',
                title: 'Industrial action',
                text:
                    'We do not pay for a delay caused by a strike or industrial action that was announced ' +
                    'before the policy was purchased.',
            },
            COMMON_CLAUSES.claimDeadline,
        ],
    },
    {
        policyId: 'P-91',
        product: 'SkyGuard Plus',
        holderCustomerId: 'C-2077',
        coverageStart: '2026-09-01',
        coverageEnd: '2026-12-31',
        purchasedAt: new Date('2026-08-28T08:30:00Z'),
        claimDeadlineDays: 45,
        delayMeasure: 'arrival',
        payoutTiers: [
            { minDelayMinutes: 90, amount: 3000, currency: 'INR' },
            { minDelayMinutes: 180, amount: 6000, currency: 'INR' },
        ],
        clauseRefs: { coveragePeriod: '2.1', claimDeadline: '9.2', delayMeasure: '4.1', payoutTiers: '4.2' },
        clauses: [
            COMMON_CLAUSES.definitions,
            COMMON_CLAUSES.coveragePeriod,
            {
                id: '4.1',
                title: 'How delay is measured',
                text:
                    'Delay is measured as the difference between the scheduled arrival and the actual arrival ' +
                    'of the flight at your destination.',
            },
            {
                id: '4.2',
                title: 'Delay benefit',
                text: 'We pay INR 3,000 for an arrival delay of 90 minutes or more, and INR 6,000 for 3 hours or more.',
            },
            {
                id: '5.2',
                title: 'Weather is covered',
                text:
                    'Unlike our Standard cover, SkyGuard Plus pays the delay benefit even when the delay is caused ' +
                    'by weather.',
            },
            COMMON_CLAUSES.knownBeforePurchase,
            COMMON_CLAUSES.claimDeadline,
        ],
    },
    {
        policyId: 'P-12',
        product: 'SkyGuard Standard',
        holderCustomerId: 'C-1042',
        coverageStart: '2025-01-01',
        coverageEnd: '2025-12-31',
        purchasedAt: new Date('2024-12-15T12:00:00Z'),
        claimDeadlineDays: 30,
        delayMeasure: 'departure',
        payoutTiers: [{ minDelayMinutes: 120, amount: 2000, currency: 'INR' }],
        clauseRefs: { coveragePeriod: '2.1', claimDeadline: '9.2', delayMeasure: '4.1', payoutTiers: '4.2' },
        clauses: [
            COMMON_CLAUSES.definitions,
            COMMON_CLAUSES.coveragePeriod,
            {
                id: '4.1',
                title: 'How delay is measured',
                text: 'Delay is measured from the scheduled departure to the actual departure.',
            },
            { id: '4.2', title: 'Delay benefit', text: 'We pay INR 2,000 for a delay of 2 hours or more.' },
            COMMON_CLAUSES.claimDeadline,
        ],
    },
];
