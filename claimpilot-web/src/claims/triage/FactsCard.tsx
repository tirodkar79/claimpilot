import { Lock } from 'lucide-react';
import type { ClaimFacts } from '../claims.api';
import styles from './triage.module.css';

interface FactsCardProps {
    /** Undefined while the Intake agent is still working. */
    facts?: ClaimFacts;
}

/**
 * Formats minutes as `4h 00m`.
 * @param minutes Delay in minutes.
 */
function formatDelay(minutes: number): string {
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/**
 * Facts the Intake agent extracted. Claimed delay and cause are marked as claimant assertions:
 * later phases check them against flight and weather evidence.
 */
export function FactsCard({ facts }: FactsCardProps) {
    const route = facts?.origin || facts?.destination ? `${facts.origin ?? '?'} → ${facts.destination ?? '?'}` : null;
    const rows: { label: string; value: string | null; assertion?: boolean }[] = [
        { label: 'Flight', value: facts?.flightNumber ?? null },
        { label: 'Date', value: facts?.flightDate ?? null },
        { label: 'Route', value: route },
        {
            label: 'Claimed delay',
            value: facts?.claimedDelayMinutes ? formatDelay(facts.claimedDelayMinutes) : null,
            assertion: true,
        },
        { label: 'Claimed cause', value: facts?.claimedCause ?? null, assertion: true },
    ];

    return (
        <section className={styles.card}>
            <h3 className={styles.cardTitle}>
                <Lock size={15} strokeWidth={1.8} className={styles.accentIcon} />
                Intake
                <span className={styles.cardSub}>{facts ? 'extracted' : 'waiting for agent'}</span>
            </h3>
            <dl className={styles.facts}>
                {rows.map((row) => (
                    <div key={row.label} className={styles.factRow}>
                        <dt>{row.label}</dt>
                        <dd className={row.value ? styles.mono : styles.missing}>{row.value ?? '—'}</dd>
                        <dd>{row.value && row.assertion && <span className={styles.assertion}>assertion</span>}</dd>
                    </div>
                ))}
            </dl>
        </section>
    );
}
