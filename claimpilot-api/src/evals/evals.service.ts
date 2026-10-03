import { Injectable, NotFoundException } from '@nestjs/common';
import type { EvalRun } from './eval-run.schema';
import { EvalRunsRepository, type EvalRunSummary } from './eval-runs.repository';

/** Eval run as exposed by the API. */
export type EvalRunView = Omit<EvalRun, '_id' | 'startedAt' | 'finishedAt'> & {
    id: string;
    startedAt: string;
    finishedAt: string;
};
export type EvalRunSummaryView = Omit<EvalRunView, 'cases'>;

const RECENT_RUNS = 30;

@Injectable()
export class EvalsService {
    constructor(private readonly runs: EvalRunsRepository) {}

    /** Recent runs, newest first, without per-case detail (for the trend and the run picker). */
    async listRecent(): Promise<EvalRunSummaryView[]> {
        return (await this.runs.findRecentSummaries(RECENT_RUNS)).map(toView);
    }

    /**
     * One run with every case and attempt.
     * @param id Run id.
     * @throws NotFoundException when the run doesn't exist or the id is malformed.
     */
    async get(id: string): Promise<EvalRunView> {
        const run = await this.runs.findById(id);
        if (!run) throw new NotFoundException('Eval run not found');
        return toView(run);
    }
}

/**
 * Maps a stored run to its API shape.
 * @param run Stored run, with or without cases.
 */
function toView<T extends EvalRunSummary>(run: T) {
    const { _id, startedAt, finishedAt, ...rest } = run;
    return { ...rest, id: String(_id), startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString() };
}
