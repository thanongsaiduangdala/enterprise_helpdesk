import { UnauthorizedException } from '@nestjs/common';
import { SessionsService } from '../sessions/sessions.service';

// Shared by JwtStrategy (runs on every normal authenticated route) and MfaSetupGuard
// (which needs to accept a normal session token as ONE of its two valid token types).
// Keeping this in one place means session-validation behavior can't quietly diverge
// between the two call sites over time.
export async function validateSessionPayload(payload: any, sessionsService: SessionsService) {
    if (!payload.sessionId) {
        throw new UnauthorizedException('Invalid token for this operation');
    }
    const valid = await sessionsService.isValid(payload.sessionId);
    if (!valid) {
        throw new UnauthorizedException('Session has been revoked or expired');
    }
    sessionsService.touch(payload.sessionId);

    return {
        userId: payload.sub,
        email: payload.email,
        role: payload.role,
        permissions: payload.permissions,
        sessionId: payload.sessionId,
    };
}
