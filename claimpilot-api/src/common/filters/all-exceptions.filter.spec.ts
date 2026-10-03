import { ArgumentsHost, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { UpstreamError } from '../../http-client/upstream.error';
import { RequestContext } from '../../request-context/request-context';
import { AllExceptionsFilter } from './all-exceptions.filter';

/**
 * Runs the filter against a fake response and captures what it wrote.
 * @param exception Exception to handle.
 */
function respond(exception: unknown): { status: number; body: unknown } {
    let status = 0;
    let body: unknown;
    const response = {
        status: (code: number) => {
            status = code;
            return { json: (payload: unknown) => (body = payload) };
        },
    };
    const host = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost;
    RequestContext.run({ requestId: 'req-1' }, () => new AllExceptionsFilter().catch(exception, host));
    return { status, body };
}

beforeAll(() => jest.spyOn(Logger.prototype, 'error').mockImplementation());

describe('AllExceptionsFilter', () => {
    it('maps HttpException to a coded error with the request id', () => {
        expect(respond(new NotFoundException('Claim not found'))).toEqual({
            status: 404,
            body: { error: { code: 'NOT_FOUND', message: 'Claim not found', requestId: 'req-1' } },
        });
    });

    it('keeps structured details', () => {
        const exception = new BadRequestException({
            message: 'Invalid claim',
            details: [{ path: 'flightNo' }],
        });
        expect(respond(exception).body).toMatchObject({
            error: { code: 'BAD_REQUEST', message: 'Invalid claim', details: [{ path: 'flightNo' }] },
        });
    });

    it('turns message arrays into validation details', () => {
        expect(respond(new BadRequestException(['flightNo is required'])).body).toMatchObject({
            error: { message: 'Validation failed', details: ['flightNo is required'] },
        });
    });

    it.each([
        [new UpstreamError('open-meteo', 'open-meteo timed out', 'UPSTREAM_TIMEOUT', undefined, true), 504],
        [new UpstreamError('flights', 'flights responded 503', 'UPSTREAM_503', 503, true), 502],
    ])('maps upstream failures to gateway statuses', (exception, status) => {
        expect(respond(exception)).toMatchObject({ status, body: { error: { code: exception.code } } });
    });

    it('hides the message of unknown errors', () => {
        expect(respond(new Error('connection string mongodb://user:secret@host'))).toEqual({
            status: 500,
            body: { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', requestId: 'req-1' } },
        });
    });
});
