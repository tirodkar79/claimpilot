import { ApiError, type ApiErrorBody } from '../api/api-error';
import { authHeaders } from '../api/http-client';
import { env } from '../config/env';

/** Mirrors TraceEventView in claimpilot-api/src/trace/trace.service.ts. */
export interface TraceEvent {
    claimId: string;
    seq: number;
    actor: 'orchestrator' | 'intake';
    type: 'triage.started' | 'agent.started' | 'agent.completed' | 'agent.failed' | 'decision' | 'triage.completed';
    message: string;
    data?: Record<string, unknown>;
    durationMs?: number;
    at: string;
}

/**
 * Incremental parser for a `text/event-stream` body. Feed it decoded chunks; it returns the JSON
 * payload of every complete event, keeping partial events until the rest arrives.
 */
export function createSseParser<T>(): (chunk: string) => T[] {
    let buffer = '';
    return (chunk) => {
        buffer += chunk;
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';
        return blocks
            .map((block) =>
                block
                    .split('\n')
                    .filter((line) => line.startsWith('data:'))
                    .map((line) => line.slice(5).trimStart())
                    .join('\n'),
            )
            .filter(Boolean)
            .map((data) => JSON.parse(data) as T);
    };
}

/**
 * Streams a claim's trace events until triage completes. Uses `fetch` rather than `EventSource`
 * because EventSource cannot send the API key header.
 * @param claimId Claim id.
 * @param onEvent Called for every event, in order.
 * @param signal Aborts the stream (e.g. on unmount).
 * @throws ApiError when the stream cannot be opened.
 */
export async function streamClaimEvents(
    claimId: string,
    onEvent: (event: TraceEvent) => void,
    signal: AbortSignal,
): Promise<void> {
    let response: Response;
    try {
        response = await fetch(`${env.apiUrl}/claims/${claimId}/events`, { headers: authHeaders(), signal });
    } catch (error) {
        if (signal.aborted) throw error;
        throw new ApiError('NETWORK_ERROR', 'Could not reach the ClaimPilot API');
    }
    if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => undefined)) as ApiErrorBody | undefined;
        throw new ApiError(
            body?.error?.code ?? `HTTP_${response.status}`,
            body?.error?.message ?? 'Could not open the event stream',
            response.status,
            body?.error?.requestId,
        );
    }

    const parse = createSseParser<TraceEvent>();
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        parse(value).forEach(onEvent);
    }
}
