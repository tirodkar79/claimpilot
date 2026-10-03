import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { UpstreamError } from '../../http-client/upstream.error';
import { RequestContext } from '../../request-context/request-context';

export interface ErrorResponseBody {
    error: { code: string; message: string; requestId?: string; details?: unknown };
}

const ERROR_CODE_BY_STATUS: Record<number, string> = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    422: 'UNPROCESSABLE_ENTITY',
    429: 'TOO_MANY_REQUESTS',
    503: 'SERVICE_UNAVAILABLE',
};

/** Every error leaves the API as `{ error: { code, message, requestId, details? } }`. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
    private readonly logger = new Logger(AllExceptionsFilter.name);

    /**
     * Writes the error response and logs 5xx failures with their stack.
     * @param exception Anything thrown while handling the request.
     * @param host Arguments host for the current request.
     */
    catch(exception: unknown, host: ArgumentsHost): void {
        const { status, body } = this.toErrorResponse(exception);
        body.error.requestId = RequestContext.requestId();

        if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
            const error = exception instanceof Error ? exception : new Error(String(exception));
            this.logger.error(`${body.error.code}: ${error.message}`, error.stack);
        }
        host.switchToHttp().getResponse<Response>().status(status).json(body);
    }

    /**
     * Maps an exception to a status and body: HttpException keeps its status, upstream timeouts
     * become 504, other upstream failures 502, and anything else a generic 500.
     * @param exception Anything thrown while handling the request.
     */
    private toErrorResponse(exception: unknown): { status: number; body: ErrorResponseBody } {
        if (exception instanceof HttpException) {
            const status = exception.getStatus();
            const payload = exception.getResponse();
            const { message, details } =
                typeof payload === 'string' ? { message: payload, details: undefined } : unpack(payload);
            return {
                status,
                body: { error: { code: ERROR_CODE_BY_STATUS[status] ?? `HTTP_${status}`, message, details } },
            };
        }

        if (exception instanceof UpstreamError) {
            const status = exception.code === 'UPSTREAM_TIMEOUT' ? HttpStatus.GATEWAY_TIMEOUT : HttpStatus.BAD_GATEWAY;
            return { status, body: { error: { code: exception.code, message: exception.message } } };
        }

        // Unknown errors never leak internals to the client; the stack goes to the log.
        return {
            status: HttpStatus.INTERNAL_SERVER_ERROR,
            body: { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } },
        };
    }
}

/**
 * Extracts message and details from an HttpException's object payload.
 * A message array (validation errors) becomes `details` under a "Validation failed" message.
 * @param payload Object passed to the HttpException.
 */
function unpack(payload: object): { message: string; details?: unknown } {
    const { message, details } = payload as { message?: string | string[]; details?: unknown };
    if (Array.isArray(message)) return { message: 'Validation failed', details: message };
    return { message: message ?? 'Error', details };
}
