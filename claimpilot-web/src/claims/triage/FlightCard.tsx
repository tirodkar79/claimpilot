import { Plane } from 'lucide-react';
import type { ClaimOutcome, FlightFindings } from '../claims.api';
import { DelayTimeline } from './DelayTimeline';
import styles from './triage.module.css';

interface FlightCardProps {
    /** Undefined until the Flight agent has run (or when it wasn't needed). */
    findings?: FlightFindings;
    /** How the policy measures delay; defaults to departure until the policy is read. */
    measure?: 'departure' | 'arrival';
    claimedMinutes?: number | null;
    outcome?: ClaimOutcome;
}

const SOURCE_LABELS = { recorded: 'recorded data', aerodatabox: 'AeroDataBox live' } as const;

/**
 * Formats an instant as local "22 Sep, 18:40".
 * @param iso ISO time.
 * @param timeZone IANA time zone.
 */
function localTime(iso: string | undefined, timeZone: string): string {
    if (!iso) return '—';
    return new Intl.DateTimeFormat('en-GB', {
        timeZone,
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    }).format(new Date(iso));
}

/** What the flight record shows, next to what was claimed. */
export function FlightCard({ findings, measure = 'departure', claimedMinutes, outcome }: FlightCardProps) {
    const leg = findings?.leg;
    let sourceLabel = 'not checked yet';
    if (findings) sourceLabel = findings.source ? SOURCE_LABELS[findings.source] : 'no record';
    return (
        <section className={styles.card}>
            <h3 className={styles.cardTitle}>
                <Plane size={15} strokeWidth={1.8} className={styles.accentIcon} />
                Flight evidence
                <span className={styles.cardSub}>{sourceLabel}</span>
            </h3>

            {findings && !leg && (
                <p className={styles.missing}>
                    No record of {findings.flightNumber} on {findings.claimedDate}
                    {findings.lookups.length > 1 ? ` (also checked ${findings.lookups[1].date})` : ''}.
                </p>
            )}

            {leg && (
                <>
                    <dl className={styles.facts}>
                        <div className={styles.factRow}>
                            <dt>Route</dt>
                            <dd className={styles.mono}>
                                {leg.flightNumber} · {leg.origin.iata} → {leg.destination.iata}
                            </dd>
                            <dd>
                                <span className={leg.status === 'cancelled' ? styles.statusBad : styles.statusOk}>
                                    {leg.status}
                                </span>
                            </dd>
                        </div>
                        <div className={styles.factRow}>
                            <dt>Departure</dt>
                            <dd className={styles.mono}>
                                {localTime(leg.scheduledDeparture, leg.origin.timeZone)} →{' '}
                                {localTime(leg.actualDeparture, leg.origin.timeZone)}
                            </dd>
                            <dd />
                        </div>
                        <div className={styles.factRow}>
                            <dt>Arrival</dt>
                            <dd className={styles.mono}>
                                {localTime(leg.scheduledArrival, leg.destination.timeZone)} →{' '}
                                {localTime(leg.actualArrival, leg.destination.timeZone)}
                            </dd>
                            <dd />
                        </div>
                    </dl>
                    {leg.status !== 'cancelled' && (
                        <DelayTimeline
                            measure={measure}
                            scheduled={measure === 'departure' ? leg.scheduledDeparture : leg.scheduledArrival}
                            actual={measure === 'departure' ? leg.actualDeparture : leg.actualArrival}
                            timeZone={measure === 'departure' ? leg.origin.timeZone : leg.destination.timeZone}
                            claimedMinutes={claimedMinutes}
                            tierMinutes={outcome?.payout?.minDelayMinutes}
                        />
                    )}
                    {findings.selectedBy === 'code' && (
                        <p className={styles.missing}>
                            Leg chosen by code, not by the agent: its pick didn't match the record.
                        </p>
                    )}
                </>
            )}
        </section>
    );
}
