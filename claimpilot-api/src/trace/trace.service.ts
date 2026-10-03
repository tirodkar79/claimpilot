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
     */
    forClaim(claimId: string): TraceRecorder {
        let seq = 0;
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
     * Streams a claim's events: stored history first, then live events, completing after the
     * terminal event. Live events are buffered while history loads and de-duplicated by `seq`.
     * @param claimId Claim id.
     */
    stream(claimId: string): Observable<TraceEventView> {
        return new Observable<TraceEventView>((subscriber) => {
            let lastSeq = 0;
            let historyLoaded = false;
            const buffered: TraceEventView[] = [];

            const emit = (event: TraceEventView) => {
                if (event.seq <= lastSeq) return;
                lastSeq = event.seq;
                subscriber.next(event);
                if (event.type === TERMINAL_TRACE_EVENT) subscriber.complete();
            };

            const live = this.live$
                .pipe(filter((event) => event.claimId === claimId))
                .subscribe((event) => (historyLoaded ? emit(event) : buffered.push(event)));

            this.repository
                .findByClaim(claimId)
                .then((history) => {
                    history.map(toView).forEach(emit);
                    buffered.forEach(emit);
                    historyLoaded = true;
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
