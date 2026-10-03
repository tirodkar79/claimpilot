export type UpstreamErrorCode = 'UPSTREAM_TIMEOUT' | 'UPSTREAM_UNAVAILABLE' | `UPSTREAM_${number}`;

/** Normalised failure from any outbound HTTP call. Never carries the upstream response body. */
export class UpstreamError extends Error {
    constructor(
        readonly service: string,
        message: string,
        readonly code: UpstreamErrorCode,
        readonly status: number | undefined,
        readonly retriable: boolean,
    ) {
        super(message);
        this.name = 'UpstreamError';
    }
}
