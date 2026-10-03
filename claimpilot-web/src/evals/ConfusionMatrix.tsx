import type { ClaimDecision } from '../claims/claims.api';
import type { EvalMetrics } from './evals.api';
import styles from './EvalsPage.module.css';

const DECISIONS: { value: ClaimDecision; label: string }[] = [
    { value: 'APPROVE', label: 'Approve' },
    { value: 'REJECT', label: 'Reject' },
    { value: 'REFER', label: 'Refer' },
    { value: 'NEED_INFO', label: 'Need info' },
];

/**
 * Plain-language reading of the off-diagonal cells: approvals that shouldn't be are the costly kind.
 * @param confusion Expected → actual → count.
 */
function verdict(confusion: EvalMetrics['confusion']): string {
    const falseApprovals = DECISIONS.filter(({ value }) => value !== 'APPROVE').reduce(
        (sum, { value }) => sum + confusion[value].APPROVE,
        0,
    );
    const errors = DECISIONS.flatMap((row) =>
        DECISIONS.filter((col) => col.value !== row.value).map((col) => confusion[row.value][col.value]),
    ).reduce((sum, count) => sum + count, 0);
    if (falseApprovals) return `${falseApprovals} approval(s) that should not have been paid.`;
    if (!errors) return 'Every decision matched.';
    return 'No false approvals: every error is on the cautious side.';
}

/**
 * Cell colour: a hit, an approval that shouldn't be (costly), or another miss.
 * @param expected Row decision.
 * @param actual Column decision.
 */
function cellTone(expected: ClaimDecision, actual: ClaimDecision): string {
    if (expected === actual) return styles.cellHit;
    return actual === 'APPROVE' ? styles.cellBad : styles.cellMiss;
}

/** Expected (rows) against actual (columns) decision counts. */
export function ConfusionMatrix({ confusion, attempts }: { confusion: EvalMetrics['confusion']; attempts: number }) {
    const max = Math.max(1, ...DECISIONS.flatMap((row) => DECISIONS.map((col) => confusion[row.value][col.value])));
    return (
        <section className={styles.card}>
            <h3 className={styles.cardTitle}>
                Decision confusion matrix <span className={styles.sub}>{attempts} attempts · expected ↓ actual →</span>
            </h3>
            <div className={styles.matrix} role="table" aria-label="Expected against actual decisions">
                <div role="row" className={styles.matrixRow}>
                    <span />
                    {DECISIONS.map((col) => (
                        <span key={col.value} role="columnheader" className={styles.matrixHead}>
                            {col.label}
                        </span>
                    ))}
                </div>
                {DECISIONS.map((row) => (
                    <div role="row" key={row.value} className={styles.matrixRow}>
                        <span role="rowheader" className={styles.matrixHead}>
                            {row.label}
                        </span>
                        {DECISIONS.map((col) => {
                            const count = confusion[row.value][col.value];
                            const tone = cellTone(row.value, col.value);
                            return (
                                <span
                                    key={col.value}
                                    role="cell"
                                    className={`${styles.cell} ${count ? tone : ''}`}
                                    style={{ '--fill': `${(count / max) * 100}%` } as React.CSSProperties}
                                >
                                    {count}
                                </span>
                            );
                        })}
                    </div>
                ))}
            </div>
            <p className={styles.note}>{verdict(confusion)}</p>
        </section>
    );
}
