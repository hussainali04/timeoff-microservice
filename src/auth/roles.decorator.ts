import { SetMetadata } from '@nestjs/common';
import { JwtRole } from './jwt.strategy';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: JwtRole[]) => SetMetadata(ROLES_KEY, roles);

