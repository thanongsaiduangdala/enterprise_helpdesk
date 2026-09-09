import { UnauthorizedException } from '@nestjs/common';
import { SessionsService } from '../sessions/sessions.service';





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
