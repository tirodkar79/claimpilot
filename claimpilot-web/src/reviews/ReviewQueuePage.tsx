import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { ApiError } from '../api/api-error';
import { usePersistedStore } from '../lib/persisted-store';
import { roleStore } from '../auth/role.store';
import { decideReview, listReviews, type ReviewDecision, type ReviewItem } from './reviews.api';
import styles from './ReviewQueuePage.module.css';

const DECISIONS: { value: ReviewDecision['decision']; label: string }[] = [
    { value: 'APPROVE', label: 'Approve' },
    { value: 'REJECT', label: 'Reject' },
    { value: 'NEED_INFO', label: 'Ask claimant' },
];

/**
 * Formats minutes as "3h 50m".
 * @param minutes Minutes.
 */
function duration(minutes: number): string {
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** Reviewer's work queue: referred claims, oldest first, with a decision form for the selected one. */
export function ReviewQueuePage() {
    const [role] = usePersistedStore(roleStore);
    const queue = useQuery({
        queryKey: ['reviews', 'pending'],
        queryFn: () => listReviews('pending'),
        enabled: role === 'reviewer',
    });
    const [selectedId, setSelectedId] = useState<string>();

    if (role !== 'reviewer') {
        return <p className={styles.notice}>The review queue is for reviewers. Switch to Reviewer in the top bar.</p>;
    }
    if (queue.isError) return <p className={styles.error}>{queue.error.message}</p>;

    const items = queue.data?.items ?? [];
    const selected = items.find((item) => item.claimId === selectedId) ?? items[0];

    return (
        <div className={styles.layout}>
            <section className={styles.card}>
                <h3 className={styles.title}>
                    Referred claims <span className={styles.count}>{queue.data?.total ?? '…'} open</span>
                </h3>
                {items.length === 0 && queue.isSuccess && <p className={styles.muted}>Nothing to review.</p>}
                {items.length > 0 && (
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>Claim</th>
                                <th>Flight</th>
                                <th>Why referred</th>
                                <th className={styles.num}>Delay</th>
                                <th className={styles.num}>Would pay</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((item) => (
                                <tr
                                    key={item.claimId}
                                    aria-selected={item.claimId === selected?.claimId}
                                    onClick={() => setSelectedId(item.claimId)}
                                >
                                    <td className={styles.mono}>{item.claimId.slice(-6)}</td>
                                    <td className={styles.mono}>
                                        {item.flightNumber ?? '—'} · {item.flightDate ?? '—'}
                                    </td>
                                    <td>
                                        {item.integrityFlags.length
                                            ? item.integrityFlags.join(', ').replaceAll('_', ' ')
                                            : item.referralReasons[0]}
                                    </td>
                                    <td className={styles.num}>
                                        {item.evidencedDelayMinutes !== undefined
                                            ? duration(item.evidencedDelayMinutes)
                                            : '—'}
                                    </td>
                                    <td className={styles.num}>
                                        {item.qualifyingPayout
                                            ? `${item.qualifyingPayout.currency} ${item.qualifyingPayout.amount.toLocaleString('en-IN')}`
                                            : '—'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </section>
            {selected && <DecisionPanel key={selected.claimId} item={selected} />}
        </div>
    );
}

/**
 * Evidence summary and decision form for one referral.
 * @param props The referral.
 */
function DecisionPanel({ item }: { item: ReviewItem }) {
    const queryClient = useQueryClient();
    const [decision, setDecision] = useState<ReviewDecision['decision']>('APPROVE');
    const [note, setNote] = useState('');
    const [payoutAmount, setPayoutAmount] = useState(item.qualifyingPayout?.amount ?? item.payoutOptions[0]?.amount);
    const submit = useMutation<ReviewItem, ApiError, ReviewDecision>({
        mutationFn: (body) => decideReview(item.claimId, body),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reviews'] }),
    });

    /**
     * Sends the decision; the payout only applies to approvals.
     * @param event Form submit event.
     */
    const onSubmit = (event: FormEvent) => {
        event.preventDefault();
        submit.mutate({ decision, note, ...(decision === 'APPROVE' && { payoutAmount }) });
    };

    return (
        <form className={styles.card} onSubmit={onSubmit}>
            <h3 className={styles.title}>
                Claim {item.claimId.slice(-6)}
                <Link className={styles.link} to={`/claims/${item.claimId}`}>
                    Open full evidence →
                </Link>
            </h3>
            <ul className={styles.reasons}>
                {item.referralReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                ))}
            </ul>

            <div className={styles.segmented} role="radiogroup" aria-label="Decision">
                {DECISIONS.map((option) => (
                    <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={decision === option.value}
                        onClick={() => setDecision(option.value)}
                    >
                        {option.label}
                    </button>
                ))}
            </div>

            {decision === 'APPROVE' && (
                <label className={styles.field}>
                    <span>Payout tier</span>
                    <select value={payoutAmount} onChange={(e) => setPayoutAmount(Number(e.target.value))}>
                        {item.payoutOptions.map((option) => (
                            <option key={option.amount} value={option.amount}>
                                {option.currency} {option.amount.toLocaleString('en-IN')} ({option.minDelayMinutes / 60}
                                h+)
                                {option.amount === item.qualifyingPayout?.amount ? ' · matches recorded delay' : ''}
                            </option>
                        ))}
                    </select>
                </label>
            )}

            <label className={styles.field}>
                <span>Note (required)</span>
                <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    placeholder="Why you decided this"
                />
            </label>

            {submit.error && (
                <p className={styles.error} role="alert">
                    {submit.error.message}
                </p>
            )}
            <button type="submit" className={styles.primary} disabled={submit.isPending || note.trim().length < 5}>
                {submit.isPending ? 'Saving…' : 'Record decision'}
            </button>
        </form>
    );
}
