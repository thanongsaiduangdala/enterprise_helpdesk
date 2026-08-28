import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY, RequiredPermission } from '../decorators/require-permission.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
    constructor(private reflector: Reflector) { }

    canActivate(context: ExecutionContext): boolean {
        const required = this.reflector.get<RequiredPermission>(
            PERMISSION_KEY,
            context.getHandler(),
        );
        if (!required) return true;

        const request = context.switchToHttp().getRequest();
        const user = request.user;
        if (!user) throw new ForbiddenException('Not authenticated');

        const permissions = user.permissions ?? [];
        const hasPermission = permissions.some(
            (p: { module: string; actions: string[] }) =>
                p.module === required.module && p.actions.includes(required.action),
        );

        if (!hasPermission) {
            throw new ForbiddenException(
                `Missing permission: ${required.action} on ${required.module}`,
            );
        }
        return true;
    }
}