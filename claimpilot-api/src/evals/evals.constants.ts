import { join } from 'node:path';
import type { ClaimDecision, FailureTarget } from '../claims/claims.constants';
import type { CreateClaimDto } from '../claims/create-claim.dto';

/** What each check grades. Each dimension isolates one kind of failure, so a regression names its cause. */
export const EVAL_DIMENSIONS = ['decision', 'extraction', 'routing', 'tools', 'grounding', 'safety'] as const;
export type EvalDimension = (typeof EVAL_DIMENSIONS)[number];

export const SUB_AGENTS = ['policy', 'flight', 'weather'] as const;
export type SubAgent = (typeof SUB_AGENTS)[number];

/** Tool-call limits per agent, matching the caps enforced in code. */
export const TOOL_CALL_LIMITS: Record<SubAgent, number> = { policy: 3, flight: 2, weather: 4 };

/** Weather the eval's stand-in for the MCP server reports (evals don't depend on real weather). */
export type EvalWeather =
    { kind: 'clear' } | { kind: 'severe'; airport: string; weatherCode: number } | { kind: 'down' };

/** Mongo database for eval claims and runs, kept apart from the app's own claims. */
export const EVAL_DATABASE = 'claimpilot-evals';
export const EVAL_CONNECTION = 'evals';

/** Eval files, relative to where `npm run eval` runs (the API folder). */
export const EVALS_DIR = join(process.cwd(), 'evals');
export const BASELINE_FILE = join(EVALS_DIR, 'baseline.json');
export const REPORT_FILE = join(EVALS_DIR, 'report.json');
export const REVIEWED_CASES_DIR = join(EVALS_DIR, 'cases', 'reviewed');

export interface EvalCase {
    id: string;
    title: string;
    /** What the case traps, e.g. "trust evidence over the claimant". */
    tests: string;
    /** `review` cases come from human reviewers' decisions and measure agreement, not regressions. */
    source: 'scenario' | 'review';
    input: CreateClaimDto;
    injectFailures?: FailureTarget[];
    weather?: EvalWeather;
    /** Earlier claims stored before this one runs (e.g. an approved claim for the same flight). */
    priorClaims?: { decision: ClaimDecision; flightNumber: string; flightDate: string }[];
    expect: {
        decision: ClaimDecision;
        payoutAmount?: number;
        citations?: string[];
        /** Facts Intake must extract (subset). */
        facts?: Partial<Record<'flightNumber' | 'flightDate' | 'origin' | 'destination', string>> & {
            claimedDelayMinutes?: number;
        };
        /** Sub-agents the orchestrator must delegate to itself (not via the guard). */
        delegates?: SubAgent[];
        /** Sub-agents that must not run at all. */
        notRun?: SubAgent[];
        /** Times the guard is expected to step in; default 0. */
        guardInterventions?: number;
        injectionSuspected?: boolean;
    };
}

export interface EvalCheck {
    dimension: EvalDimension;
    name: string;
    pass: boolean;
    detail?: string;
}

export interface JudgeScore {
    clarity: number;
    faithfulness: number;
    tone: number;
    comment: string;
}

export interface EvalAttempt {
    decision?: ClaimDecision;
    payoutAmount?: number;
    /** Reasons the rules engine gave, for diagnosing a wrong decision. */
    reasons?: string[];
    checks: EvalCheck[];
    guardInterventions: number;
    toolCalls: number;
    durationMs: number;
    summary?: string;
    judge?: JudgeScore;
    error?: string;
}

export interface EvalCaseResult {
    id: string;
    title: string;
    tests: string;
    source: EvalCase['source'];
    expectedDecision: ClaimDecision;
    attempts: EvalAttempt[];
}

/** Rates are 0–1 over all attempts of scenario cases. */
export interface EvalMetrics {
    /** Scored attempts. */
    attempts: number;
    /** Attempts lost to model-provider errors (quota, outage); not scored. */
    erroredAttempts: number;
    decisionAccuracy: number;
    /** Approved when it shouldn't have been: the most expensive error. */
    falseApproveRate: number;
    dimensionPassRates: Record<EvalDimension, number>;
    /** Cases whose every attempt passed every check. */
    consistentCases: number;
    /** Cases where some scored attempts passed and some failed. */
    flakyCases: number;
    cases: number;
    guardInterventions: number;
    /** Expected decision → actual decision → count. */
    confusion: Record<string, Record<string, number>>;
    averageDurationMs: number;
    /** Share of review cases where triage matched the reviewer; null when there are none. */
    reviewerAgreement: number | null;
    /** Mean judge scores (1–5); null when the judge didn't run. */
    judge: { clarity: number; faithfulness: number; tone: number } | null;
}

export interface EvalRegression {
    metric: string;
    baseline: number;
    current: number;
}
