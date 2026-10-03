import { isAxiosError } from 'axios';

/** Error body every API failure returns (see claimpilot-api AllExceptionsFilter). */
export interface ApiErrorBody {
    error?: { code?: string; message?: string; requestId?: string; details?: unknown };
}

/** Normalised API failure used across the UI. */
export class ApiError extends Error {
    /**
     * @param code Stable error code, e.g. `NOT_FOUND`, `UPSTREAM_TIMEOUT`, `NETWORK_ERROR`.
     * @param message Human-readable message.
     * @param status HTTP status, undefined when the request never got a response.
     * @param requestId Request id to quote when reporting the problem.
     * @param details Extra structured information, e.g. validation issues.
     */
    constructor(
        readonly code: string,
        message: string,
        readonly status?: number,
        readonly requestId?: string,
        readonly details?: unknown,
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

/**
 * Converts anything thrown by the HTTP client into an {@link ApiError}.
 * @param error Thrown value.
 */
export function toApiError(error: unknown): ApiError {
    if (error instanceof ApiError) return error;
    if (!isAxiosError<ApiErrorBody>(error)) {
        return new ApiError('UNKNOWN_ERROR', error instanceof Error ? error.message : 'Unknown error');
    }
    if (!error.response) {
        return new ApiError('NETWORK_ERROR', 'Could not reach the ClaimPilot API');
    }

    const { status, data, headers } = error.response;
    const body = data?.error;
    return new ApiError(
        body?.code ?? `HTTP_${status}`,
        body?.message ?? error.message,
        status,
        body?.requestId ?? (headers['x-request-id'] as string | undefined),
        body?.details,
    );
}
