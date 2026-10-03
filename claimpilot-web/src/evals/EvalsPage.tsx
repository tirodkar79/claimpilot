import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { roleStore } from '../auth/role.store';
import { usePersistedStore } from '../lib/persisted-store';
import { AccuracyTrend } from './AccuracyTrend';
import { ConfusionMatrix } from './ConfusionMatrix';
import { getEvalRun, listEvalRuns, type EvalRunSummary } from './evals.api';
import { percent, runTime } from './eval-format';
import { ScenarioTable } from './ScenarioTable';
import styles from './EvalsPage.module.css';

interface TileProps {
    label: string;
    value: string;
    note: string;
    tone?: 'ok' | 'bad';
}

/** One headline metric. */
function Tile({ label, value, note, tone }: TileProps) {
    return (
        <div className={`${styles.tile} ${tone ? styles[tone] : ''}`}>
            <div className={styles.eyebrow}>{label}</div>
            <div className={styles.tileValue}>{value}</div>
            <div className={styles.note}>{note}</div>
        </div>
    );
}

/**
 * Change in decision accuracy against the previous run, e.g. "▲ 5.3 pts vs previous run".
 * @param runs Recent runs, newest first.
 * @param run Selected run.
 */
function accuracyChange(runs: EvalRunSummary[], run: EvalRunSummary): string {
    const previous = runs[runs.findIndex((candidate) => candidate.id === run.id) + 1];
    if (!previous) return 'first run';
    const points = (run.metrics.decisionAccuracy - previous.metrics.decisionAccuracy) * 100;
    if (Math.abs(points) < 0.05) return 'same as previous run';
    return `${points > 0 ? '▲' : '▼'} ${Math.abs(points).toFixed(1)} pts vs previous run`;
}

/** Baseline comparison as a pill. */
function BaselinePill({ run }: { run: EvalRunSummary }) {
    if (!run.comparedWithBaseline) return <span className={styles.pill}>Not compared with baseline</span>;
    if (!run.regressions.length)
        return <span className={`${styles.pill} ${styles.ok}`}>No regression vs baseline</span>;
    return (
        <span className={`${styles.pill} ${styles.bad}`}>
            Regression: {run.regressions.map((regression) => regression.metric).join(', ')}
        </span>
    );
}

/** Eval results: headline metrics, confusion matrix, per-scenario grades and the accuracy trend. Reviewers only. */
export function EvalsPage() {
    const [role] = usePersistedStore(roleStore);
    const runs = useQuery({ queryKey: ['eval-runs'], queryFn: listEvalRuns, enabled: role === 'reviewer' });
    const [selectedId, setSelectedId] = useState<string>();
    const summary = runs.data?.find((run) => run.id === selectedId) ?? runs.data?.[0];
    const detail = useQuery({
        queryKey: ['eval-runs', summary?.id],
        queryFn: () => getEvalRun(summary!.id),
        enabled: !!summary,
    });

    if (role !== 'reviewer') {
        return <p className={styles.notice}>Evaluations are for reviewers. Switch to Reviewer in the top bar.</p>;
    }
    if (runs.isError) return <p className={styles.error}>{runs.error.message}</p>;
    if (runs.isSuccess && !summary) {
        return (
            <p className={styles.notice}>
                No eval runs yet. Run <code>npm run eval</code> in claimpilot-api.
            </p>
        );
    }
    if (!summary || !runs.data) return <p className={styles.notice}>Loading…</p>;

    const { metrics } = summary;
    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <label className={styles.picker}>
                    <span className={styles.srOnly}>Eval run</span>
                    <select value={summary.id} onChange={(event) => setSelectedId(event.target.value)}>
                        {runs.data.map((run) => (
                            <option key={run.id} value={run.id}>
                                {runTime(run.startedAt)} · {percent(run.metrics.decisionAccuracy)}
                            </option>
                        ))}
                    </select>
                </label>
                <span className={styles.pill}>
                    {metrics.cases} cases × {summary.repeats}
                </span>
                <span className={`${styles.pill} ${styles.mono}`}>{summary.model}</span>
                {metrics.erroredAttempts > 0 && (
                    <span className={styles.pill}>{metrics.erroredAttempts} attempt(s) lost to provider errors</span>
                )}
                <BaselinePill run={summary} />
            </header>

            <div className={styles.tiles}>
                <Tile
                    label="False-approve rate"
                    value={percent(metrics.falseApproveRate)}
                    note="target 0 · most costly error"
                    tone={metrics.falseApproveRate === 0 ? 'ok' : 'bad'}
                />
                <Tile
                    label="Decision accuracy"
                    value={percent(metrics.decisionAccuracy)}
                    note={accuracyChange(runs.data, summary)}
                />
                <Tile
                    label="Routing"
                    value={percent(metrics.dimensionPassRates.routing)}
                    note={`${metrics.guardInterventions} guard intervention(s)`}
                />
                <Tile
                    label="Grounding"
                    value={percent(metrics.dimensionPassRates.grounding)}
                    note="summaries with only evidenced values"
                />
                <Tile
                    label="Flaky cases"
                    value={String(metrics.flakyCases)}
                    note={`${metrics.consistentCases} / ${metrics.cases} passed every attempt`}
                />
            </div>

            <div className={styles.columns}>
                <ConfusionMatrix confusion={metrics.confusion} attempts={metrics.attempts} />
                <AccuracyTrend runs={runs.data} selectedId={summary.id} />
                <section className={styles.card}>
                    <h3 className={styles.cardTitle}>Other signals</h3>
                    <dl className={styles.signals}>
                        <dt>Extraction</dt>
                        <dd>{percent(metrics.dimensionPassRates.extraction)}</dd>
                        <dt>Tool use</dt>
                        <dd>{percent(metrics.dimensionPassRates.tools)}</dd>
                        <dt>Safety</dt>
                        <dd>{percent(metrics.dimensionPassRates.safety)}</dd>
                        <dt>Reviewer agreement</dt>
                        <dd>{metrics.reviewerAgreement === null ? '—' : percent(metrics.reviewerAgreement)}</dd>
                        <dt>Explanation (judge, 1–5)</dt>
                        <dd>
                            {metrics.judge
                                ? `clarity ${metrics.judge.clarity} · faithful ${metrics.judge.faithfulness} · tone ${metrics.judge.tone}`
                                : 'not judged'}
                        </dd>
                        <dt>Average per claim</dt>
                        <dd>{(metrics.averageDurationMs / 1000).toFixed(1)}s</dd>
                    </dl>
                </section>
            </div>

            {detail.data && <ScenarioTable cases={detail.data.cases} />}
            {detail.isError && <p className={styles.error}>{detail.error.message}</p>}
        </div>
    );
}
