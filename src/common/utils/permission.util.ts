interface PermissionEntry {
    module: string;
    actions: string[];
}

/** Role name that is always allowed to do everything (matches the frontend isFullAdmin bypass). */
export const SUPER_ADMIN_ROLE = 'SUPER_ADMIN';

export interface PermissionUser {
    userId?: string;
    role?: string;
    permissions?: PermissionEntry[];
}

/**
 * Same matching rule as PermissionsGuard, but usable inside a controller/service
 * when a route needs to widen or narrow its result set based on extra actions.
 */
export function hasPermission(
    user: PermissionUser | undefined,
    module: string,
    action: string,
): boolean {
    if (user?.role === SUPER_ADMIN_ROLE) return true;
    return (user?.permissions ?? []).some(
        (p) => p.module === module && p.actions.includes(action),
    );
}

/** True when the user holds any one of the given actions on the module. */
export function hasAnyPermission(
    user: PermissionUser | undefined,
    module: string,
    actions: string[],
): boolean {
    return actions.some((action) => hasPermission(user, module, action));
}