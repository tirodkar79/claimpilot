import { httpClient } from '../api/http-client';
import type { ClaimDecision } from '../claims/claims.api';

/** Mirrors claimpilot-api/src/evals/evals.constants.ts. */
export const EVAL_DIMENSIONS = ['decision', 'extraction', 'routing', 'tools', 'grounding', 'safety'] as const;
export type EvalDimension = (typeof EVAL_DIMENSIONS)[number];

export interface EvalCheck {
    dimension: EvalDimension;
    name: string;
    pass: boolean;
    detail?: string;
}

export interface EvalAttempt {
    decision?: ClaimDecision;
    payoutAmount?: number;
    reasons?: string[];
    checks: EvalCheck[];
    guardInterventions: number;
    toolCalls: number;
    durationMs: number;
    summary?: string;
    judge?: { clarity: number; faithfulness: number; tone: number; comment: string };
    error?: string;
}

export interface EvalCaseResult {
    id: string;
    title: string;
    tests: string;
    source: 'scenario' | 'review';
    expectedDecision: ClaimDecision;
    attempts: EvalAttempt[];
}

export interface EvalMetrics {
    attempts: number;
    erroredAttempts: number;
    decisionAccuracy: number;
    falseApproveRate: number;
    dimensionPassRates: Record<EvalDimension, number>;
    consistentCases: number;
    flakyCases: number;
    cases: number;
    guardInterventions: number;
    confusion: Record<ClaimDecision, Record<ClaimDecision, number>>;
    averageDurationMs: number;
    reviewerAgreement: number | null;
    judge: { clarity: number; faithfulness: number; tone: number } | null;
}

export interface EvalRunSummary {
    id: string;
    startedAt: string;
    finishedAt: string;
    model: string;
    repeats: number;
    judged: boolean;
    metrics: EvalMetrics;
    regressions: { metric: string; baseline: number; current: number }[];
    comparedWithBaseline: boolean;
}

export interface EvalRun extends EvalRunSummary {
    cases: EvalCaseResult[];
}

/** Recent eval runs, newest first, without per-case detail. */
export async function listEvalRuns(): Promise<EvalRunSummary[]> {
    const { data } = await httpClient.get<EvalRunSummary[]>('/evals/runs');
    return data;
}

/**
 * One eval run with every case and attempt.
 * @param id Run id.
 */
export async function getEvalRun(id: string): Promise<EvalRun> {
    const { data } = await httpClient.get<EvalRun>(`/evals/runs/${id}`);
    return data;
}
