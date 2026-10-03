import { UserCheck } from 'lucide-react';
import type { ClaimReview } from '../claims.api';
import styles from './triage.module.css';

const DECISION_LABELS = { APPROVE: 'Approved', REJECT: 'Rejected', NEED_INFO: 'Asked the claimant for more' };

/** Human review of a referred claim: waiting, or the reviewer's decision with their note. */
export function ReviewCard({ review }: { review: ClaimReview }) {
    return (
        <section className={styles.card}>
            <h3 className={styles.cardTitle}>
                <UserCheck size={15} strokeWidth={1.8} className={styles.accentIcon} />
                Human review
                <span className={styles.cardSub}>
                    {review.status === 'pending' ? 'waiting for a reviewer' : 'decided'}
                </span>
            </h3>
            {review.status === 'resolved' && review.decision && (
                <>
                    <p className={styles.lead}>
                        <b>{DECISION_LABELS[review.decision]}</b>
                        {review.payout &&
                            ` · ${review.payout.currency} ${review.payout.amount.toLocaleString('en-IN')}`}
                    </p>
                    {review.note && <p className={styles.missing}>“{review.note}”</p>}
                </>
            )}
        </section>
    );
}
