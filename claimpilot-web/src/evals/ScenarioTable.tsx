import { EVAL_DIMENSIONS, type EvalAttempt, type EvalCaseResult, type EvalDimension } from './evals.api';
import styles from './EvalsPage.module.css';

/**
 * How many scored attempts passed every check of one dimension; null when the case has no such checks.
 * @param attempts Attempts of a case (provider errors excluded).
 * @param dimension Dimension.
 */
function dimensionScore(
    attempts: EvalAttempt[],
    dimension: EvalDimension,
): { passed: number; failures: string[] } | null {
    const graded = attempts.filter((attempt) => attempt.checks.some((check) => check.dimension === dimension));
    if (!graded.length) return null;
    const failures = graded.flatMap((attempt) =>
        attempt.checks
            .filter((check) => check.dimension === dimension && !check.pass)
            .map((check) => (check.detail ? `${check.name}: ${check.detail}` : check.name)),
    );
    const passed = graded.filter((attempt) =>
        attempt.checks.every((check) => check.dimension !== dimension || check.pass),
    ).length;
    return { passed, failures: [...new Set(failures)] };
}

/** One row per case: expected and actual decisions per attempt, and pass counts per dimension. */
export function ScenarioTable({ cases }: { cases: EvalCaseResult[] }) {
    return (
        <section className={`${styles.card} ${styles.wide}`}>
            <h3 className={styles.cardTitle}>
                Scenarios <span className={styles.sub}>attempts passing each dimension · hover a miss for why</span>
            </h3>
            <div className={styles.tableScroll}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>Case</th>
                            <th>Expected</th>
                            <th>Got</th>
                            {EVAL_DIMENSIONS.map((dimension) => (
                                <th key={dimension} className={styles.center}>
                                    {dimension}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {cases.map((result) => {
                            const scored = result.attempts.filter((attempt) => !attempt.error);
                            const errored = result.attempts.length - scored.length;
                            return (
                                <tr key={result.id}>
                                    <td>
                                        <div className={styles.caseTitle}>
                                            {result.title}
                                            {result.source === 'review' && <span className={styles.tag}>review</span>}
                                        </div>
                                        <div className={styles.caseTests}>{result.tests}</div>
                                    </td>
                                    <td className={styles.mono}>{result.expectedDecision}</td>
                                    <td className={styles.mono}>
                                        {scored.map((attempt, index) => (
                                            <span
                                                key={index}
                                                title={attempt.reasons?.join('\n')}
                                                className={
                                                    attempt.decision === result.expectedDecision
                                                        ? styles.ok
                                                        : styles.bad
                                                }
                                            >
                                                {attempt.decision ?? '—'}{' '}
                                            </span>
                                        ))}
                                        {errored > 0 && (
                                            <span
                                                className={styles.muted}
                                                title={result.attempts.find((a) => a.error)?.error}
                                            >
                                                +{errored} errored
                                            </span>
                                        )}
                                    </td>
                                    {EVAL_DIMENSIONS.map((dimension) => {
                                        const score = dimensionScore(scored, dimension);
                                        if (!score) {
                                            return (
                                                <td key={dimension} className={`${styles.center} ${styles.muted}`}>
                                                    —
                                                </td>
                                            );
                                        }
                                        const allPassed = score.passed === scored.length;
                                        return (
                                            <td
                                                key={dimension}
                                                className={`${styles.center} ${allPassed ? styles.ok : styles.bad}`}
                                                title={score.failures.join('\n') || undefined}
                                            >
                                                {score.passed}/{scored.length}
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
