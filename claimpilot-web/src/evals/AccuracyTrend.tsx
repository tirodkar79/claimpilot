import type { EvalRunSummary } from './evals.api';
import { runTime } from './eval-format';
import styles from './EvalsPage.module.css';

const WIDTH = 460;
const HEIGHT = 160;
const PAD = { left: 34, right: 12, top: 14, bottom: 24 };

/** Decision accuracy of recent runs, oldest to newest; runs with a regression are marked. */
export function AccuracyTrend({ runs, selectedId }: { runs: EvalRunSummary[]; selectedId?: string }) {
    const ordered = [...runs].reverse();
    if (ordered.length < 2) {
        return (
            <section className={styles.card}>
                <h3 className={styles.cardTitle}>Decision accuracy by run</h3>
                <p className={styles.note}>The trend appears after the second run.</p>
            </section>
        );
    }

    const x = (index: number) => PAD.left + (index * (WIDTH - PAD.left - PAD.right)) / (ordered.length - 1);
    const y = (value: number) => PAD.top + (1 - value) * (HEIGHT - PAD.top - PAD.bottom);
    const points = ordered.map((run, index) => `${x(index)},${y(run.metrics.decisionAccuracy)}`).join(' ');

    return (
        <section className={styles.card}>
            <h3 className={styles.cardTitle}>
                Decision accuracy by run <span className={styles.sub}>last {ordered.length}</span>
            </h3>
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" role="img" aria-label="Decision accuracy by run">
                {[0, 0.5, 1].map((value) => (
                    <g key={value}>
                        <line
                            className={styles.grid}
                            x1={PAD.left}
                            x2={WIDTH - PAD.right}
                            y1={y(value)}
                            y2={y(value)}
                        />
                        <text className={styles.axis} x={PAD.left - 6} y={y(value) + 3} textAnchor="end">
                            {value * 100}
                        </text>
                    </g>
                ))}
                <polyline className={styles.line} points={points} />
                {ordered.map((run, index) => (
                    <circle
                        key={run.id}
                        className={run.regressions.length ? styles.dotBad : styles.dot}
                        cx={x(index)}
                        cy={y(run.metrics.decisionAccuracy)}
                        r={run.id === selectedId ? 5.5 : 3.5}
                    >
                        <title>
                            {runTime(run.startedAt)}: {(run.metrics.decisionAccuracy * 100).toFixed(1)}%
                            {run.regressions.length ? ' (regression)' : ''}
                        </title>
                    </circle>
                ))}
            </svg>
        </section>
    );
}
