import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { SessionsService } from '../sessions/sessions.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(
        configService: ConfigService,
        private sessionsService: SessionsService,
    ) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: configService.get<string>('JWT_SECRET') as string,
        });
    }

    async validate(payload: any) {
        const valid = await this.sessionsService.isValid(payload.sessionId);
        if (!valid) {
            throw new UnauthorizedException('Session has been revoked or expired');
        }
        this.sessionsService.touch(payload.sessionId); // not awaited — don't block the request on this

        return {
            userId: payload.sub,
            email: payload.email,
            role: payload.role,
            permissions: payload.permissions,
            sessionId: payload.sessionId,
        };
    }
}