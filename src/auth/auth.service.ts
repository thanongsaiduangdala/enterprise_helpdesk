import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { SessionsService, DeviceInfoInput } from '../sessions/sessions.service';

@Injectable()
export class AuthService {
    constructor(
        private usersService: UsersService,
        private jwtService: JwtService,
        private sessionsService: SessionsService,
    ) { }

    async login(email: string, password: string, deviceInfo: DeviceInfoInput) {
        const user = await this.usersService.findByEmail(email);
        if (!user) throw new UnauthorizedException('Invalid credentials');

        const passwordMatches = await bcrypt.compare(password, user.passwordHash);
        if (!passwordMatches) throw new UnauthorizedException('Invalid credentials');

        if (!user.isActive) {
            throw new UnauthorizedException('This account has been deactivated');
        }

        const role = user.role as any; // populated Role document
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // matches JwtModule's 1d expiry

        const session = await this.sessionsService.create(
            String(user._id),
            deviceInfo,
            expiresAt,
        );

        const payload = {
            sub: user._id,
            email: user.email,
            role: role.name,
            permissions: role.permissions,
            sessionId: String(session._id),
        };
        const token = this.jwtService.sign(payload);

        return { accessToken: token };
    }
}