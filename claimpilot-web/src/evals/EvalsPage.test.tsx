import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { roleStore } from '../auth/role.store';
import type { ClaimDecision } from '../claims/claims.api';
import { getEvalRun, listEvalRuns, type EvalMetrics, type EvalRun } from './evals.api';
import { EvalsPage } from './EvalsPage';

vi.mock('./evals.api', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./evals.api')>()),
    listEvalRuns: vi.fn(),
    getEvalRun: vi.fn(),
}));

const DECISIONS: ClaimDecision[] = ['APPROVE', 'REJECT', 'REFER', 'NEED_INFO'];
const confusion = Object.fromEntries(
    DECISIONS.map((row) => [row, Object.fromEntries(DECISIONS.map((col) => [col, 0]))]),
) as EvalMetrics['confusion'];
confusion.APPROVE.APPROVE = 1;
confusion.APPROVE.REFER = 1;

const metrics: EvalMetrics = {
    attempts: 2,
    erroredAttempts: 1,
    decisionAccuracy: 0.5,
    falseApproveRate: 0,
    dimensionPassRates: { decision: 0.5, extraction: 1, routing: 0.75, tools: 1, grounding: 1, safety: 1 },
    consistentCases: 1,
    flakyCases: 0,
    cases: 2,
    guardInterventions: 0,
    confusion,
    averageDurationMs: 9000,
    reviewerAgreement: null,
    judge: null,
};

const run: EvalRun = {
    id: 'run-2',
    startedAt: '2026-10-03T04:00:00Z',
    finishedAt: '2026-10-03T04:10:00Z',
    model: 'google:gemini-3.5-flash-lite',
    repeats: 1,
    judged: false,
    metrics,
    regressions: [{ metric: 'routing', baseline: 1, current: 0.75 }],
    comparedWithBaseline: true,
    cases: [
        {
            id: 'evidenced-tier',
            title: 'Claims 4h, record shows 3h50m',
            tests: 'Payout follows the evidenced tier',
            source: 'scenario',
            expectedDecision: 'APPROVE',
            attempts: [
                {
                    decision: 'REFER',
                    checks: [
                        { dimension: 'decision', name: 'decision', pass: false, detail: 'expected APPROVE, got REFER' },
                        { dimension: 'routing', name: 'weather not run', pass: false },
                    ],
                    guardInterventions: 0,
                    toolCalls: 3,
                    durationMs: 9000,
                },
                {
                    checks: [],
                    guardInterventions: 0,
                    toolCalls: 0,
                    durationMs: 100,
                    error: 'Model provider error: quota',
                },
            ],
        },
    ],
};
const previous = {
    ...run,
    id: 'run-1',
    startedAt: '2026-10-02T04:00:00Z',
    regressions: [],
    metrics: { ...metrics, decisionAccuracy: 0.4 },
};

/** Renders the page with a fresh query client. */
function renderPage() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <EvalsPage />
        </QueryClientProvider>,
    );
}

describe('EvalsPage', () => {
    afterEach(() => roleStore.set('claimant'));

    it('is for reviewers only', () => {
        roleStore.set('claimant');
        renderPage();
        expect(screen.getByText(/Switch to Reviewer/)).toBeInTheDocument();
        expect(listEvalRuns).not.toHaveBeenCalled();
    });

    it('explains how to create the first run', async () => {
        roleStore.set('reviewer');
        vi.mocked(listEvalRuns).mockResolvedValue([]);
        renderPage();
        expect(await screen.findByText(/No eval runs yet/)).toBeInTheDocument();
    });

    it('shows headline metrics, the regression and why each scenario failed', async () => {
        roleStore.set('reviewer');
        vi.mocked(listEvalRuns).mockResolvedValue([run, previous]);
        vi.mocked(getEvalRun).mockResolvedValue(run);
        renderPage();

        expect(await screen.findByText('Regression: routing')).toBeInTheDocument();
        expect(screen.getByText('▲ 10.0 pts vs previous run')).toBeInTheDocument();
        expect(screen.getByText('1 attempt(s) lost to provider errors')).toBeInTheDocument();
        expect(screen.getByText('No false approvals: every error is on the cautious side.')).toBeInTheDocument();

        const row = (await screen.findByText('Claims 4h, record shows 3h50m')).closest('tr')!;
        expect(within(row).getByText('REFER')).toBeInTheDocument();
        expect(within(row).getByText('+1 errored')).toBeInTheDocument();
        expect(within(row).getAllByText('0/1')[1]).toHaveAttribute('title', 'weather not run');
    });

    it('switches runs', async () => {
        roleStore.set('reviewer');
        vi.mocked(listEvalRuns).mockResolvedValue([run, previous]);
        vi.mocked(getEvalRun).mockResolvedValue(run);
        renderPage();

        await userEvent.selectOptions(await screen.findByRole('combobox'), 'run-1');
        expect(getEvalRun).toHaveBeenLastCalledWith('run-1');
        expect(screen.getByText('first run')).toBeInTheDocument();
    });
});
