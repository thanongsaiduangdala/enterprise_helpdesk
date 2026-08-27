import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'permission';

export interface RequiredPermission {
    module: string;
    action: string;
}

export const RequirePermission = (module: string, action: string) =>
    SetMetadata(PERMISSION_KEY, { module, action });