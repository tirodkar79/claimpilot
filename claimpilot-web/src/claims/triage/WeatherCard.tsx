import { CloudSun } from 'lucide-react';
import type { WeatherFindings } from '../claims.api';
import styles from './triage.module.css';

interface WeatherCardProps {
    findings: WeatherFindings;
    /** IANA time zone for showing times (the airports' zone). */
    timeZone: string;
}

/**
 * Formats an instant as local "HH:mm".
 * @param iso ISO time.
 * @param timeZone IANA time zone.
 */
function clock(iso: string, timeZone: string): string {
    return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/**
 * Weather at each airport during the delay, from the Open-Meteo MCP server. Shown only when a weather exclusion
 * made the check necessary. Severe hours are listed by name so colour is never the only signal.
 */
export function WeatherCard({ findings, timeZone }: WeatherCardProps) {
    return (
        <section className={styles.card}>
            <h3 className={styles.cardTitle}>
                <CloudSun size={15} strokeWidth={1.8} className={styles.accentIcon} />
                Weather
                <span className={styles.cardSub}>Open-Meteo via MCP</span>
            </h3>
            <dl className={styles.facts}>
                {findings.checks.map((check) => (
                    <div key={check.airport} className={styles.factRow}>
                        <dt>
                            {check.airport} · {check.role}
                        </dt>
                        <dd className={styles.mono}>
                            {clock(check.windowStart, timeZone)}–{clock(check.windowEnd, timeZone)} ·{' '}
                            {check.observationCount}h checked
                        </dd>
                        <dd>
                            <span className={check.severe ? styles.statusBad : styles.statusOk}>
                                {check.severe
                                    ? [...new Set(check.severeObservations.map((o) => o.condition))].join(', ')
                                    : 'no severe weather'}
                            </span>
                        </dd>
                    </div>
                ))}
            </dl>
            <p className={styles.missing}>{findings.notes}</p>
            {findings.guardFetched.length > 0 && (
                <p className={styles.missing}>
                    Fetched by code because the agent skipped them: {findings.guardFetched.join(', ')}.
                </p>
            )}
        </section>
    );
}
