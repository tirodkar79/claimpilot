import { AlertTriangle, Clock, HelpCircle, XCircle, type LucideIcon } from 'lucide-react';
import type { ClaimDecision, ClaimOutcome } from '../claims.api';
import styles from './triage.module.css';

const PRESENTATION: Record<ClaimDecision, { label: string; tone: string; Icon: LucideIcon; lead: string }> = {
    NEED_INFO: { label: 'Need info', tone: styles.info, Icon: HelpCircle, lead: 'We need a few more details:' },
    PENDING: { label: 'Pending evidence', tone: styles.neutral, Icon: Clock, lead: '' },
    REJECT: { label: 'Rejected', tone: styles.bad, Icon: XCircle, lead: '' },
    REFER: { label: 'Referred', tone: styles.warn, Icon: AlertTriangle, lead: '' },
};

interface OutcomeCardProps {
    /** Undefined while triage is running. */
    outcome?: ClaimOutcome;
    /** Orchestrator's summary. Shown as context; the rules engine made the decision. */
    summary?: string;
}

/**
 * The decision, stamped, with its reasons and the policy clauses it relies on.
 * NEED_INFO reasons are the questions for the claimant.
 */
export function OutcomeCard({ outcome, summary }: OutcomeCardProps) {
    if (!outcome) {
        return (
            <section className={styles.card}>
                <h3 className={styles.cardTitle}>Outcome</h3>
                <p className={styles.missing}>Triage in progress…</p>
            </section>
        );
    }

    const { label, tone, Icon, lead } = PRESENTATION[outcome.decision];
    return (
        <section className={`${styles.card} ${styles.outcome}`}>
            <span className={`${styles.stamp} ${tone}`}>
                <Icon size={15} strokeWidth={2} />
                {label}
            </span>
            {lead && <p className={styles.lead}>{lead}</p>}
            <ul className={styles.reasons}>
                {outcome.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                ))}
            </ul>
            {outcome.citations.length > 0 && (
                <div className={styles.citations}>
                    {outcome.citations.map((citation) => (
                        <span key={citation.clauseId} className={styles.chip} title={citation.title}>
                            §{citation.clauseId} {citation.title}
                        </span>
                    ))}
                </div>
            )}
            {summary && (
                <div className={styles.summary}>
                    <div className={styles.eyebrow}>Orchestrator summary</div>
                    <p>{summary}</p>
                </div>
            )}
        </section>
    );
}
