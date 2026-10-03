import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { RequestContext } from '../../request-context/request-context';

/** One line per inbound request: method, path, status, latency, request id and caller role. */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
    private readonly logger = new Logger('HTTP');

    /**
     * Logs the request once the handler completes or fails.
     * @param context Current execution context.
     * @param next Handler to call.
     */
    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        const http = context.switchToHttp();
        const { method, originalUrl } = http.getRequest<Request>();
        const startedAt = Date.now();

        /** Writes the log line for the final status. */
        const log = (status: number) => {
            const store = RequestContext.get();
            this.logger.log(
                `${method} ${originalUrl} ${status} ${Date.now() - startedAt}ms ` +
                    `requestId=${store?.requestId ?? '-'} role=${store?.role ?? '-'}`,
            );
        };

        return next.handle().pipe(
            tap({
                next: () => log(http.getResponse<Response>().statusCode),
                error: (error: { status?: number }) => log(error?.status ?? 500),
            }),
        );
    }
}
