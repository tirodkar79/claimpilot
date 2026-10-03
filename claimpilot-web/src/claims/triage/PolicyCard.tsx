import { AlertTriangle, FileText } from 'lucide-react';
import type { PolicyFindings } from '../claims.api';
import styles from './triage.module.css';

interface PolicyCardProps {
    /** Undefined until the Policy agent has run (or when it wasn't needed). */
    findings?: PolicyFindings;
    policyId: string;
}

/** Labels for the API's exclusion types (snake_case values from the API). */
const EXCLUSION_LABELS = new Map([
    ['severe_weather', 'Severe weather'],
    ['industrial_action', 'Industrial action'],
    ['known_before_purchase', 'Known before purchase'],
    ['other', 'Other'],
]);

/**
 * What the Policy agent read in the wording: how delay is measured, exclusions the claimed cause
 * might trigger, and the cited clauses (expandable, so a reviewer can check the exact text).
 * Grounding problems the API detected are shown, not hidden.
 */
export function PolicyCard({ findings, policyId }: PolicyCardProps) {
    return (
        <section className={styles.card}>
            <h3 className={styles.cardTitle}>
                <FileText size={15} strokeWidth={1.8} className={styles.accentIcon} />
                Policy
                <span className={styles.cardSub}>{findings ? policyId : 'not read yet'}</span>
            </h3>

            {findings && (
                <>
                    <dl className={styles.facts}>
                        <div className={styles.factRow}>
                            <dt>Delay measured</dt>
                            <dd className={styles.mono}>from {findings.delayMeasure}</dd>
                            <dd />
                        </div>
                    </dl>

                    <div className={styles.exclusions}>
                        <div className={styles.eyebrow}>Exclusions the claimed cause might trigger</div>
                        {findings.relevantExclusions.length === 0 && <p className={styles.missing}>None flagged</p>}
                        {findings.relevantExclusions.map((exclusion) => (
                            <div key={exclusion.clauseId} className={styles.exclusion}>
                                <span className={styles.chip}>§{exclusion.clauseId}</span>
                                <b>{EXCLUSION_LABELS.get(exclusion.type) ?? exclusion.type}</b>
                                <span className={styles.missing}>{exclusion.summary}</span>
                            </div>
                        ))}
                    </div>

                    {!!findings.droppedExclusions?.length && (
                        <p className={styles.grounding} role="status">
                            <AlertTriangle size={14} strokeWidth={2} />
                            Set aside{' '}
                            {findings.droppedExclusions
                                .map((e) => `§${e.clauseId} ${EXCLUSION_LABELS.get(e.type) ?? e.type}`)
                                .join(', ')}
                            : the claimed cause doesn't support it.
                        </p>
                    )}
                    {(findings.droppedCitations.length > 0 || findings.delayMeasureMismatch) && (
                        <p className={styles.grounding} role="status">
                            <AlertTriangle size={14} strokeWidth={2} />
                            {findings.droppedCitations.length > 0 &&
                                `Ignored citations to clauses that don't exist: ${findings.droppedCitations.join(', ')}. `}
                            {findings.delayMeasureMismatch &&
                                'The agent misread how delay is measured; the schedule was used.'}
                        </p>
                    )}

                    <div className={styles.clauses}>
                        {findings.citedClauses.map((clause) => (
                            <details key={clause.id} className={styles.clause}>
                                <summary>
                                    <span className={styles.chip}>§{clause.id}</span> {clause.title}
                                </summary>
                                <p>{clause.text}</p>
                            </details>
                        ))}
                    </div>
                </>
            )}
        </section>
    );
}
