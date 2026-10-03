import { SetMetadata } from '@nestjs/common';
import { Role, ROLES_KEY } from '../auth.constants';

/** Restricts a route or controller to callers whose API key maps to one of these roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
