import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SessionsService } from '../sessions/sessions.service';
import { validateSessionPayload } from './session-token.util';

// Deliberately separate from JwtAuthGuard/JwtStrategy rather than extending them, so this
// narrow two-endpoint special case can't accidentally loosen what every OTHER authenticated
// route in the app accepts. Two valid token shapes:
//   1. purpose: 'mfa_setup_required' — short-lived, no session, issued by AuthService.login()
//      when a role mandates MFA but it hasn't been configured yet.
//   2. A normal full session token — the existing "already logged in, enabling MFA
//      voluntarily from account settings" path.
@Injectable()
export class MfaSetupGuard implements CanActivate {
    constructor(
        private jwtService: JwtService,
        private sessionsService: SessionsService,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const authHeader = request.headers['authorization'];
        if (!authHeader?.startsWith('Bearer ')) {
            throw new UnauthorizedException('Missing bearer token');
        }
        const token = authHeader.slice('Bearer '.length);

        let payload: any;
        try {
            payload = this.jwtService.verify(token);
        } catch {
            throw new UnauthorizedException('Invalid or expired token');
        }

        if (payload.purpose === 'mfa_setup_required') {
            request.user = { userId: payload.sub, purpose: 'mfa_setup_required' };
            return true;
        }

        request.user = await validateSessionPayload(payload, this.sessionsService);
        return true;
    }
}
