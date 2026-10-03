import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { REQUEST_ID_HEADER } from '../common/constants/headers.constants';
import { RequestContext } from './request-context';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Opens the request context and sets `x-request-id` (reused from the caller when well-formed).
 * Middleware rather than an interceptor so the scope also covers guards and exception filters.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
    /**
     * Assigns the request id, echoes it in the response header and runs the rest of the
     * pipeline inside the request context.
     * @param req Incoming request.
     * @param res Outgoing response.
     * @param next Continues the pipeline.
     */
    use(req: Request, res: Response, next: NextFunction): void {
        const incoming = req.header(REQUEST_ID_HEADER);
        const requestId = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
        res.setHeader(REQUEST_ID_HEADER, requestId);
        RequestContext.run({ requestId }, next);
    }
}
