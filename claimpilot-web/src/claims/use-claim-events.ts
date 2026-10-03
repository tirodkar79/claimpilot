import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useReducer } from 'react';
import { ApiError } from '../api/api-error';
import { streamClaimEvents, type TraceEvent } from './claim-events';

export type StreamStatus = 'connecting' | 'streaming' | 'done' | 'error';

interface StreamState {
    events: TraceEvent[];
    status: StreamStatus;
    error?: ApiError;
}

type StreamAction =
    | { type: 'event'; event: TraceEvent }
    | { type: 'done' }
    | { type: 'error'; error: ApiError }
    | { type: 'reconnect' };

/**
 * Appends events in sequence order. Events at or below the last seq are dropped, so a reconnect
 * (or React StrictMode's double effect) that replays history never duplicates lines.
 * @param state Current state.
 * @param action What happened.
 */
function reducer(state: StreamState, action: StreamAction): StreamState {
    switch (action.type) {
        case 'event': {
            const lastSeq = state.events.at(-1)?.seq ?? 0;
            if (action.event.seq <= lastSeq) return state;
            return { ...state, status: 'streaming', events: [...state.events, action.event] };
        }
        case 'done':
            return { ...state, status: 'done' };
        case 'reconnect':
            return { ...state, status: state.events.length ? 'streaming' : 'connecting', error: undefined };
        case 'error':
            return { ...state, status: 'error', error: action.error };
        default:
            return state;
    }
}

/**
 * Follows a claim's triage live. When triage completes, the claim query is refetched so facts and
 * outcome appear without polling.
 * @param claimId Claim id.
 * @param run Bump to reconnect after the claim is triaged again (NEED_INFO answered); events already shown stay.
 */
export function useClaimEvents(claimId: string, run = 0): StreamState {
    const queryClient = useQueryClient();
    const [state, dispatch] = useReducer(reducer, { events: [], status: 'connecting' });

    useEffect(() => {
        const controller = new AbortController();
        dispatch({ type: 'reconnect' });
        streamClaimEvents(
            claimId,
            (event) => {
                dispatch({ type: 'event', event });
                if (event.type === 'triage.completed') {
                    void queryClient.invalidateQueries({ queryKey: ['claim', claimId] });
                }
            },
            controller.signal,
        )
            .then(() => dispatch({ type: 'done' }))
            .catch((error: unknown) => {
                if (controller.signal.aborted) return;
                const apiError =
                    error instanceof ApiError ? error : new ApiError('STREAM_ERROR', 'The live trace was interrupted');
                dispatch({ type: 'error', error: apiError });
            });
        return () => controller.abort();
    }, [claimId, run, queryClient]);

    return state;
}
