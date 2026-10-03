import { Waypoints } from 'lucide-react';
import type { TraceEvent } from '../claim-events';
import type { StreamStatus } from '../use-claim-events';
import styles from './triage.module.css';

interface TraceLogProps {
    events: TraceEvent[];
    status: StreamStatus;
    error?: Error;
}

const STATUS_LABEL: Record<StreamStatus, string> = {
    connecting: 'connecting',
    streaming: 'live',
    done: 'completed',
    error: 'interrupted',
};

/**
 * Seconds since the first event, e.g. `01.20`.
 * @param event Event to time.
 * @param start First event's timestamp in ms.
 */
function offset(event: TraceEvent, start: number): string {
    return ((Date.parse(event.at) - start) / 1000).toFixed(2).padStart(5, '0');
}

/**
 * Extra style for an event: tool calls are indented under their agent, guard steps and failures stand out.
 * @param event Trace event.
 */
function lineClass(event: TraceEvent): string | undefined {
    if (event.type === 'agent.failed') return styles.logFailed;
    if (event.type === 'guard.enforced') return styles.logGuard;
    if (event.type === 'tool.called') return styles.logTool;
    return undefined;
}

/** Live list of every orchestrator and agent step, in order. */
export function TraceLog({ events, status, error }: TraceLogProps) {
    const start = events[0] ? Date.parse(events[0].at) : 0;

    return (
        <section className={`${styles.card} ${styles.traceCard}`}>
            <h3 className={styles.cardTitle}>
                <Waypoints size={15} strokeWidth={1.8} className={styles.accentIcon} />
                Trace
                <span className={styles.cardSub}>{STATUS_LABEL[status]}</span>
            </h3>
            <ol className={styles.log} aria-live="polite">
                {events.map((event) => (
                    <li key={event.seq} className={lineClass(event)}>
                        <span className={styles.logTime}>{offset(event, start)}</span>
                        <span className={styles.logActor}>{event.actor}</span>
                        <span>{event.message}</span>
                        {event.durationMs !== undefined && (
                            <span className={styles.logTime}>{(event.durationMs / 1000).toFixed(1)}s</span>
                        )}
                    </li>
                ))}
            </ol>
            {error && (
                <p className={styles.logError} role="alert">
                    {error.message}
                </p>
            )}
        </section>
    );
}
