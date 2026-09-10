import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { generateSecret, generate, verify, generateURI } from 'otplib';
import * as qrcode from 'qrcode';
import { UsersService } from '../users/users.service';
import { SessionsService, DeviceInfoInput } from '../sessions/sessions.service';
import { MfaAttemptsService } from '../mfa-attempts/mfa-attempts.service';
import { MailService } from '../mail/mail.service';

const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;
const MFA_LOGIN_LOCKOUT_TTL_SECONDS = 15 * 60;
const MFA_ENABLE_LOCKOUT_TTL_SECONDS = 15 * 60;
const MFA_EMAIL_CODE_TTL_SECONDS = 10 * 60;
const MFA_SETUP_REQUIRED_TTL = '15m';

@Injectable()
export class AuthService {
    constructor(
        private usersService: UsersService,
        private jwtService: JwtService,
        private sessionsService: SessionsService,
        private mfaAttemptsService: MfaAttemptsService,
        private mailService: MailService,
    ) { }

    private generateEmailCode(): string {
        return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    }

    private hashCode(code: string): string {
        return crypto.createHash('sha256').update(code).digest('hex');
    }

    private async issueAndSendEmailCode(key: string, email: string, firstName: string) {
        const code = this.generateEmailCode();
        await this.mfaAttemptsService.issueCode(key, this.hashCode(code), MFA_EMAIL_CODE_TTL_SECONDS);
        await this.mailService.sendMail(
            email,
            'Your Enterprise Helpdesk verification code',
            `<p>Hi ${firstName},</p>
             <p>Your verification code is: <b>${code}</b></p>
             <p>This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>`,
        );
    }

    async login(email: string, password: string, deviceInfo: DeviceInfoInput) {
        const user = await this.usersService.findByEmail(email);
        if (!user) throw new UnauthorizedException('Invalid credentials');

        const passwordMatches = await bcrypt.compare(password, user.passwordHash);
        if (!passwordMatches) throw new UnauthorizedException('Invalid credentials');

        if (!user.isActive) {
            throw new UnauthorizedException('This account has been deactivated');
        }

        if (user.mfa?.enabled) {

            await this.mfaAttemptsService.assertNotLockedOut(`login:${user._id}`);

            const mfaToken = this.jwtService.sign(
                { sub: user._id, purpose: 'mfa_challenge' },
                { expiresIn: '5m' },
            );
            await this.mfaAttemptsService.createChallenge(mfaToken, MFA_CHALLENGE_TTL_SECONDS);

            if (user.mfa.method === 'email') {
                await this.issueAndSendEmailCode(`email-code:login:${user._id}`, user.email, user.firstName);
            }

            return { mfaRequired: true, mfaToken, mfaMethod: user.mfa.method };
        }

        const role = user.role as any;
        if (role?.mfaRequired) {
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

    async setupMfa(userId: string, method: 'totp' | 'email') {
        const user = await this.usersService.findOneRaw(userId);

        if (method === 'email') {
            await this.usersService.setPendingMfaMethod(userId, 'email');
            await this.issueAndSendEmailCode(`email-code:enable:${userId}`, user.email, user.firstName);
            return { method: 'email', codeSent: true };
        }

        const secret = generateSecret();

        await this.usersService.setPendingMfaSecret(userId, secret);

        const otpauthUrl = generateURI({
            issuer: 'Enterprise Helpdesk',
            label: user.email,
            secret,
        });
        const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);

        return { method: 'totp', otpauthUrl, qrCodeDataUrl };
    }

    async resendSetupEmailCode(userId: string) {
        const user = await this.usersService.findOneRaw(userId);
        if (user.mfa?.pendingMethod !== 'email') {
            throw new BadRequestException('No pending email MFA setup to resend a code for');
        }

        await this.issueAndSendEmailCode(`email-code:enable:${userId}`, user.email, user.firstName);
        return { codeSent: true };
    }

    async enableMfa(userId: string, code: string, deviceInfo?: DeviceInfoInput) {
        const user = await this.usersService.findOneRaw(userId);
        const pendingMethod = user.mfa?.pendingMethod;
        if (!pendingMethod) {
            throw new BadRequestException('Call /auth/mfa/setup first to choose and start an MFA method before enabling it');
        }

        const key = `enable:${userId}`;
        await this.mfaAttemptsService.assertNotLockedOut(key);

        let valid: boolean;
        if (pendingMethod === 'email') {
            const codeKey = `email-code:enable:${userId}`;
            valid = await this.mfaAttemptsService.verifyCode(codeKey, this.hashCode(code));
            if (valid) await this.mfaAttemptsService.reset(codeKey);
        } else {
            if (!user.mfa?.pendingSecret) {
                throw new BadRequestException('Call /auth/mfa/setup first to generate a secret before enabling MFA');
            }
            const result = await verify({ secret: user.mfa.pendingSecret, token: code });
            valid = result.valid;
        }

        if (!valid) {
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

        const tokenKey = this.mfaAttemptsService.hashKey(mfaToken);
        const lockoutKey = `login:${payload.sub}`;

        await this.mfaAttemptsService.assertNotConsumed(tokenKey);
        await this.mfaAttemptsService.assertNotLockedOut(lockoutKey);

        const user = await this.usersService.findOne(payload.sub);
        if (!user) throw new NotFoundException('User not found');

        let valid: boolean;
        if (user.mfa?.method === 'email') {
            const codeKey = `email-code:login:${user._id}`;
            valid = await this.mfaAttemptsService.verifyCode(codeKey, this.hashCode(code));
            if (valid) await this.mfaAttemptsService.reset(codeKey);
        } else {
            if (!user.mfa?.secret) {
                throw new BadRequestException('MFA is not set up for this account');
            }
            const result = await verify({ secret: user.mfa.secret, token: code });
            valid = result.valid;
        }

        if (!valid) {
            await this.mfaAttemptsService.recordFailure(lockoutKey, MFA_LOGIN_LOCKOUT_TTL_SECONDS);
            throw new UnauthorizedException('Invalid MFA code');
        }

        await this.mfaAttemptsService.markConsumed(tokenKey);
        await this.mfaAttemptsService.reset(lockoutKey);
        return this.completeLogin(user, deviceInfo);
    }

    async resendLoginEmailCode(mfaToken: string) {
        let payload: any;
        try {
            payload = this.jwtService.verify(mfaToken);
        } catch {
            throw new UnauthorizedException('MFA challenge token is invalid or expired — please log in again');
        }
        if (payload.purpose !== 'mfa_challenge') {
            throw new UnauthorizedException('Invalid token for this operation');
        }

        const tokenKey = this.mfaAttemptsService.hashKey(mfaToken);
        const lockoutKey = `login:${payload.sub}`;
        await this.mfaAttemptsService.assertNotConsumed(tokenKey);
        await this.mfaAttemptsService.assertNotLockedOut(lockoutKey);

        const user = await this.usersService.findOne(payload.sub);
        if (!user) throw new NotFoundException('User not found');
        if (user.mfa?.method !== 'email') {
            throw new BadRequestException('This account is not using email MFA');
        }

        await this.issueAndSendEmailCode(`email-code:login:${user._id}`, user.email, user.firstName);
        return { codeSent: true };
    }
}