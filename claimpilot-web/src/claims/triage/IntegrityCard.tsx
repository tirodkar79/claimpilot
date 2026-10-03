import { ShieldCheck } from 'lucide-react';
import type { IntegrityFindings } from '../claims.api';
import styles from './triage.module.css';

interface IntegrityCardProps {
    findings: IntegrityFindings;
}

/** Labels for the API's snake_case check results. */
const LABELS = new Map([
    ['matched', 'claimant on booking'],
    ['not_given', 'no booking quoted'],
    ['problem', 'booking problem'],
    ['before_departure', 'bought before departure'],
    ['after_departure', 'bought after departure'],
    ['not_checked', 'not checked (no flight record)'],
]);

/** Integrity checks run before any payout: what was checked, and any flag with its explanation. */
export function IntegrityCard({ findings }: IntegrityCardProps) {
    const { checked, flags } = findings;
    const rows = [
        { label: 'Duplicates', value: checked.duplicates ? `${checked.duplicates} other claim(s)` : 'none' },
        { label: 'Booking', value: LABELS.get(checked.booking) },
        { label: 'Policy purchase', value: LABELS.get(checked.purchase) },
    ];
    return (
        <section className={styles.card}>
            <h3 className={styles.cardTitle}>
                <ShieldCheck size={15} strokeWidth={1.8} className={styles.accentIcon} />
                Integrity checks
                <span className={styles.cardSub}>{flags.length ? `${flags.length} flag(s)` : 'no flags'}</span>
            </h3>
            <dl className={styles.facts}>
                {rows.map((row) => (
                    <div key={row.label} className={styles.factRow}>
                        <dt>{row.label}</dt>
                        <dd className={styles.mono}>{row.value}</dd>
                        <dd />
                    </div>
                ))}
            </dl>
            {flags.map((flag) => (
                <p key={flag.code} className={styles.grounding} role="status">
                    <b>{flag.code.replaceAll('_', ' ')}</b>
                    {flag.detail}
                    {flag.clauseId && <span className={styles.chip}>§{flag.clauseId}</span>}
                </p>
            ))}
        </section>
    );
}
