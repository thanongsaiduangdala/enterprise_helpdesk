interface PermissionEntry {
    module: string;
    actions: string[];
}

export interface PermissionUser {
    userId?: string;
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
