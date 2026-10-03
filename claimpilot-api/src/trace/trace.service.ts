import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { filter, Observable, Subject } from 'rxjs';
import { TERMINAL_TRACE_EVENT, type TraceActor, type TraceEventType } from './trace.constants';
import { TraceRepository } from './trace.repository';

/** Trace event as exposed by the API. */
export interface TraceEventView {
    claimId: string;
    seq: number;
    actor: TraceActor;
    type: TraceEventType;
    message: string;
    data?: Record<string, unknown>;
    durationMs?: number;
    at: string;
}

/** Records one claim's events with an increasing sequence number. */
export interface TraceRecorder {
    /**
     * Stores and broadcasts an event.
     * @param actor Agent or orchestrator that produced it.
     * @param type Event type.
     * @param message Human-readable summary.
     * @param extra Optional structured data and duration.
     */
    record(
        actor: TraceActor,
        type: TraceEventType,
        message: string,
        extra?: { data?: Record<string, unknown>; durationMs?: number },
    ): Promise<TraceEventView>;
}

/**
 * Persists trace events and streams them live. Events are written to MongoDB first, then broadcast,
 * so a client that connects late gets the full history followed by live events, without gaps.
 */
@Injectable()
export class TraceService {
    private readonly live$ = new Subject<TraceEventView>();

    constructor(private readonly repository: TraceRepository) {}

    /**
     * Returns a recorder for one triage run. Single-process: sequence numbers are kept in memory.
     * @param claimId Claim being triaged.
     * @param startAfterSeq Last sequence number already stored (0 for a new claim).
     */
    forClaim(claimId: string, startAfterSeq = 0): TraceRecorder {
        let seq = startAfterSeq;
        return {
            record: async (actor, type, message, extra = {}) => {
                seq += 1;
                const stored = await this.repository.create({
                    claimId: new Types.ObjectId(claimId),
                    seq,
                    actor,
                    type,
                    message,
                    ...extra,
                    at: new Date(),
                });
                const view = toView(stored);
                this.live$.next(view);
                return view;
            },
        };
    }

    /**
     * Appends one event to a claim whose triage already finished (e.g. a reviewer's decision).
     * @param claimId Claim id.
     * @param actor Who produced the event.
     * @param type Event type.
     * @param message Human-readable summary.
     * @param extra Optional structured data.
     */
    async append(
        claimId: string,
        actor: TraceActor,
        type: TraceEventType,
        message: string,
        extra?: { data?: Record<string, unknown> },
    ): Promise<TraceEventView> {
        const last = await this.repository.lastSeq(claimId);
        return this.forClaim(claimId, last).record(actor, type, message, extra);
    }

    /**
     * Streams a claim's events: the full stored history first (including later events such as a review), then
     * live events until triage completes. Live events are buffered while history loads and de-duplicated by `seq`.
     * @param claimId Claim id.
     */
    stream(claimId: string): Observable<TraceEventView> {
        return new Observable<TraceEventView>((subscriber) => {
            let lastSeq = 0;
            let historyLoaded = false;
            let triageFinished = false;
            const buffered: TraceEventView[] = [];

            /** Emits an event once, in order; remembers whether triage has finished. */
            const emit = (event: TraceEventView) => {
                if (event.seq <= lastSeq) return;
                lastSeq = event.seq;
                subscriber.next(event);
                if (event.type === TERMINAL_TRACE_EVENT) triageFinished = true;
            };

            const live = this.live$.pipe(filter((event) => event.claimId === claimId)).subscribe((event) => {
                if (!historyLoaded) return void buffered.push(event);
                emit(event);
                if (triageFinished) subscriber.complete();
            });

            this.repository
                .findByClaim(claimId)
                .then((history) => {
                    // Replay everything, including events after triage (e.g. a review), then close if triage is over.
                    history.map(toView).forEach(emit);
                    buffered.forEach(emit);
                    historyLoaded = true;
                    if (triageFinished) subscriber.complete();
                })
                .catch((error: unknown) => subscriber.error(error));

            return () => live.unsubscribe();
        });
    }
}

/**
 * Maps a stored event to its API shape.
 * @param event Stored event.
 */
function toView(event: {
    claimId: Types.ObjectId;
    seq: number;
    actor: TraceActor;
    type: TraceEventType;
    message: string;
    data?: Record<string, unknown>;
    durationMs?: number;
    at: Date;
}): TraceEventView {
    return {
        claimId: String(event.claimId),
        seq: event.seq,
        actor: event.actor,
        type: event.type,
        message: event.message,
        data: event.data,
        durationMs: event.durationMs,
        at: event.at.toISOString(),
    };
}
