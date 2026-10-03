import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { API_KEY_HEADER } from '../common/constants/headers.constants';
import { EnvConfig } from '../config/env.validation';
import { RequestContext } from '../request-context/request-context';
import { IS_PUBLIC_KEY, Role, ROLES_KEY } from './auth.constants';

/**
 * Global guard: every route needs a valid `x-api-key` unless marked `@Public()`.
 * The key resolves to a role, which `@Roles()` can restrict.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly config: ConfigService<EnvConfig, true>,
    ) {}

    /**
     * Resolves the caller's role from `x-api-key` and enforces any `@Roles()` on the route.
     * @param context Current execution context.
     * @returns `true` when the request may proceed.
     * @throws UnauthorizedException when the key is missing or unknown.
     * @throws ForbiddenException when the caller's role is not allowed on the route.
     */
    canActivate(context: ExecutionContext): boolean {
        const targets = [context.getHandler(), context.getClass()];
        if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

        const apiKey = context.switchToHttp().getRequest<Request>().header(API_KEY_HEADER);
        const role = apiKey ? this.config.get('API_KEYS', { infer: true }).get(apiKey) : undefined;
        if (!role) throw new UnauthorizedException('Missing or invalid API key');

        const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
        if (required?.length && !required.includes(role)) {
            throw new ForbiddenException(`Requires role: ${required.join(' or ')}`);
        }

        RequestContext.setRole(role);
        return true;
    }
}
