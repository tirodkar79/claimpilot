import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { RequestContext } from '../request-context/request-context';
import { ApiKeyGuard } from './api-key.guard';
import { IS_PUBLIC_KEY, Role, ROLES_KEY } from './auth.constants';

const apiKeys = new Map<string, Role>([
    ['claimant-key', Role.Claimant],
    ['reviewer-key', Role.Reviewer],
]);

/**
 * Builds the guard with stubbed route metadata and the test API keys.
 * @param metadata Route metadata the reflector should return.
 */
function createGuard(metadata: { isPublic?: boolean; roles?: Role[] } = {}): ApiKeyGuard {
    const reflector = {
        getAllAndOverride: (key: string) =>
            key === IS_PUBLIC_KEY ? metadata.isPublic : key === ROLES_KEY ? metadata.roles : undefined,
    } as unknown as Reflector;
    const config = { get: () => apiKeys } as unknown as ConfigService<never, true>;
    return new ApiKeyGuard(reflector, config);
}

/**
 * Builds an execution context whose request carries the given `x-api-key`.
 * @param apiKey Header value, or undefined for no header.
 */
function contextWithKey(apiKey?: string): ExecutionContext {
    const request = { header: (name: string) => (name === 'x-api-key' ? apiKey : undefined) };
    return {
        getHandler: () => undefined,
        getClass: () => undefined,
        switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
}

describe('ApiKeyGuard', () => {
    it('allows @Public() routes without a key', () => {
        expect(createGuard({ isPublic: true }).canActivate(contextWithKey())).toBe(true);
    });

    it.each([
        ['missing', undefined],
        ['unknown', 'not-a-key'],
    ])('rejects a %s key with 401', (_label, apiKey) => {
        expect(() => createGuard().canActivate(contextWithKey(apiKey))).toThrow(UnauthorizedException);
    });

    it('records the caller role in the request context', () => {
        RequestContext.run({ requestId: 'req-1' }, () => {
            expect(createGuard().canActivate(contextWithKey('claimant-key'))).toBe(true);
            expect(RequestContext.get()?.role).toBe(Role.Claimant);
        });
    });

    it('rejects a valid key without the required role with 403', () => {
        const guard = createGuard({ roles: [Role.Reviewer] });
        expect(() => guard.canActivate(contextWithKey('claimant-key'))).toThrow(ForbiddenException);
    });

    it('allows a valid key with the required role', () => {
        const guard = createGuard({ roles: [Role.Reviewer] });
        expect(guard.canActivate(contextWithKey('reviewer-key'))).toBe(true);
    });
});
