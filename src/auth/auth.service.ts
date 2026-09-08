import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { generateSecret, generate, verify, generateURI } from 'otplib';
import * as qrcode from 'qrcode';
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


        if (user.mfa?.enabled) {
            const mfaToken = this.jwtService.sign(
                { sub: user._id, purpose: 'mfa_challenge' },
                { expiresIn: '5m' },
            );
            return { mfaRequired: true, mfaToken };
        }

        const result = await this.completeLogin(user, deviceInfo);

        const role = user.role as any;
        if (role?.mfaRequired && !user.mfa?.enabled) {
            return { ...result, mfaSetupRequired: true };
        }

        return result;
    }

    private async completeLogin(user: any, deviceInfo: DeviceInfoInput) {
        const role = user.role as any;
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        const session = await this.sessionsService.create(String(user._id), deviceInfo, expiresAt);

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

    async setupMfa(userId: string) {
        const user = await this.usersService.findOneRaw(userId);

        const secret = generateSecret();
        await this.usersService.setMfaSecret(userId, secret);

        const otpauthUrl = generateURI({
            issuer: 'Enterprise Helpdesk',
            label: user.email,
            secret,
        });
        const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);

        return { otpauthUrl, qrCodeDataUrl };
    }

    async enableMfa(userId: string, code: string) {
        const user = await this.usersService.findOneRaw(userId);
        if (!user.mfa?.secret) {
            throw new BadRequestException('Call /auth/mfa/setup first to generate a secret before enabling MFA');
        }

        const result = await verify({ secret: user.mfa.secret, token: code });
        if (!result.valid) {
            throw new BadRequestException('Invalid MFA code');
        }

        await this.usersService.confirmMfaEnabled(userId);
        return { enabled: true };
    }

    async verifyMfaLogin(mfaToken: string, code: string, deviceInfo: DeviceInfoInput) {
        let payload: any;
        try {
            payload = this.jwtService.verify(mfaToken);
        } catch {
            throw new UnauthorizedException('MFA challenge token is invalid or expired — please log in again');
        }
        if (payload.purpose !== 'mfa_challenge') {
            throw new UnauthorizedException('Invalid token for this operation');
        }

        const user = await this.usersService.findOne(payload.sub);
        if (!user) throw new NotFoundException('User not found');
        if (!user.mfa?.secret) {
            throw new BadRequestException('MFA is not set up for this account');
        }

        const result = await verify({ secret: user.mfa.secret, token: code });
        if (!result.valid) {
            throw new UnauthorizedException('Invalid MFA code');
        }

        return this.completeLogin(user, deviceInfo);
    }
}
