import styles from './triage.module.css';

interface DelayTimelineProps {
    /** Scheduled time (ISO) of the end of the flight the policy measures. */
    scheduled: string;
    /** Actual time (ISO); undefined when not recorded. */
    actual?: string;
    claimedMinutes?: number | null;
    /** Tier threshold reached, drawn as a marker. */
    tierMinutes?: number;
    timeZone: string;
    measure: 'departure' | 'arrival';
}

const WIDTH = 640;
const LEFT = 8;
const RIGHT = 8;
const MINUTE_MS = 60_000;

/**
 * Formats an instant as local HH:mm.
 * @param iso ISO time.
 * @param timeZone IANA time zone.
 */
function clock(iso: string, timeZone: string): string {
    return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/**
 * Claimed vs recorded delay on one time axis: solid bar = flight record, dashed outline = what the claimant
 * said, dotted line = the payout tier reached. Text labels carry the values, so colour isn't the only cue.
 */
export function DelayTimeline({
    scheduled,
    actual,
    claimedMinutes,
    tierMinutes,
    timeZone,
    measure,
}: DelayTimelineProps) {
    const evidenced = actual ? Math.max(0, (Date.parse(actual) - Date.parse(scheduled)) / MINUTE_MS) : 0;
    const span = Math.max(evidenced, claimedMinutes ?? 0, tierMinutes ?? 0, 60) * 1.15;
    const x = (minutes: number) => LEFT + (minutes / span) * (WIDTH - LEFT - RIGHT);

    const recorded = actual
        ? 'actual ' + clock(actual, timeZone) + ', ' + Math.round(evidenced) + ' minutes late'
        : 'actual not recorded';
    const claimed = claimedMinutes ? '; claimant said ' + claimedMinutes + ' minutes' : '';
    const label = `Scheduled ${measure} ${clock(scheduled, timeZone)}; ${recorded}${claimed}`;

    return (
        <svg viewBox={`0 0 ${WIDTH} 96`} className={styles.timeline} role="img" aria-label={label}>
            <rect className={styles.tlTrack} x={LEFT} y={46} width={WIDTH - LEFT - RIGHT} height={14} rx={4} />
            {claimedMinutes ? (
                <>
                    <rect
                        className={styles.tlClaimed}
                        x={x(0)}
                        y={22}
                        width={x(claimedMinutes) - x(0)}
                        height={14}
                        rx={4}
                    />
                    <text className={styles.tlLabel} x={x(0) + 6} y={33}>
                        Claimed · {claimedMinutes} min
                    </text>
                </>
            ) : null}
            {actual && (
                <>
                    <rect
                        className={styles.tlEvidence}
                        x={x(0)}
                        y={46}
                        width={x(evidenced) - x(0)}
                        height={14}
                        rx={4}
                    />
                    <text className={styles.tlOnBar} x={x(0) + 6} y={57}>
                        Recorded · {Math.round(evidenced)} min
                    </text>
                </>
            )}
            {tierMinutes !== undefined && (
                <>
                    <line className={styles.tlTier} x1={x(tierMinutes)} x2={x(tierMinutes)} y1={14} y2={68} />
                    <text className={styles.tlAxis} x={x(tierMinutes)} y={10} textAnchor="middle">
                        {tierMinutes / 60}h tier
                    </text>
                </>
            )}
            <text className={styles.tlAxis} x={LEFT} y={86}>
                {clock(scheduled, timeZone)} scheduled {measure}
            </text>
            {actual && (
                <text
                    className={styles.tlAxis}
                    x={x(evidenced)}
                    y={86}
                    textAnchor={evidenced / span > 0.6 ? 'end' : 'start'}
                >
                    {clock(actual, timeZone)} actual
                </text>
            )}
        </svg>
    );
}
