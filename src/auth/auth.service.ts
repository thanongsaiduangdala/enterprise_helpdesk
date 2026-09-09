import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { generateSecret, generate, verify, generateURI } from 'otplib';
import * as qrcode from 'qrcode';
import { UsersService } from '../users/users.service';
import { SessionsService, DeviceInfoInput } from '../sessions/sessions.service';
import { MfaAttemptsService } from '../mfa-attempts/mfa-attempts.service';

const MFA_CHALLENGE_TTL_SECONDS = 5 * 60; // matches the mfaToken's own JWT expiry — keep these in sync
const MFA_ENABLE_LOCKOUT_TTL_SECONDS = 15 * 60;
const MFA_SETUP_REQUIRED_TTL = '15m';

@Injectable()
export class AuthService {
    constructor(
        private usersService: UsersService,
        private jwtService: JwtService,
        private sessionsService: SessionsService,
        private mfaAttemptsService: MfaAttemptsService,
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
            await this.mfaAttemptsService.createChallenge(mfaToken, MFA_CHALLENGE_TTL_SECONDS);
            return { mfaRequired: true, mfaToken };
        }

        const role = user.role as any;
        if (role?.mfaRequired) {
            // Role mandates MFA and it isn't configured yet — do NOT call completeLogin here.
            // No session is created, no accessToken is issued. Instead, a narrow, short-lived
            // token is handed out that ONLY satisfies MfaSetupGuard on /auth/mfa/setup and
            // /auth/mfa/enable — it cannot be used to call any other authenticated endpoint,
            // since every other route uses JwtAuthGuard, which requires a sessionId this
            // token deliberately doesn't carry.
            const setupToken = this.jwtService.sign(
                { sub: user._id, purpose: 'mfa_setup_required' },
                { expiresIn: MFA_SETUP_REQUIRED_TTL },
            );
            return { mfaSetupRequired: true, setupToken };
        }

        return this.completeLogin(user, deviceInfo);
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

    // deviceInfo is only passed when this is called via the FORCED setup flow (no session
    // exists yet) — see MfaSetupGuard / the controller. When present, a real session is
    // created here and a real accessToken returned, so the person doesn't have to type
    // their password again immediately after finishing MFA setup. When absent (the
    // voluntary "enable MFA from account settings" path, where a session already exists),
    // this just confirms enablement and returns as before.
    async enableMfa(userId: string, code: string, deviceInfo?: DeviceInfoInput) {
        const user = await this.usersService.findOneRaw(userId);
        if (!user.mfa?.secret) {
            throw new BadRequestException('Call /auth/mfa/setup first to generate a secret before enabling MFA');
        }

        const key = `enable:${userId}`;
        await this.mfaAttemptsService.assertUsable(key);

        const result = await verify({ secret: user.mfa.secret, token: code });
        if (!result.valid) {
            await this.mfaAttemptsService.recordFailure(key, MFA_ENABLE_LOCKOUT_TTL_SECONDS);
            throw new BadRequestException('Invalid MFA code');
        }

        await this.mfaAttemptsService.reset(key);
        await this.usersService.confirmMfaEnabled(userId);

        if (deviceInfo) {
            const fullUser = await this.usersService.findOne(userId);
            const loginResult = await this.completeLogin(fullUser, deviceInfo);
            return { enabled: true, ...loginResult };
        }

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

        const key = this.mfaAttemptsService.hashKey(mfaToken);
        await this.mfaAttemptsService.assertUsable(key);

        const user = await this.usersService.findOne(payload.sub);
        if (!user) throw new NotFoundException('User not found');
        if (!user.mfa?.secret) {
            throw new BadRequestException('MFA is not set up for this account');
        }

        const result = await verify({ secret: user.mfa.secret, token: code });
        if (!result.valid) {
            await this.mfaAttemptsService.recordFailure(key, MFA_CHALLENGE_TTL_SECONDS);
            throw new UnauthorizedException('Invalid MFA code');
        }

        await this.mfaAttemptsService.markConsumed(key);
        return this.completeLogin(user, deviceInfo);
    }
}
