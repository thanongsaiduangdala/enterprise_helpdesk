import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SessionsService } from '../sessions/sessions.service';
import { validateSessionPayload } from './session-token.util';








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
