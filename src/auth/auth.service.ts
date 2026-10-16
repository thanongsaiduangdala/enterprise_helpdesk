import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { generateSecret, generate, verify, generateURI } from 'otplib';
import * as qrcode from 'qrcode';
import { UsersService } from '../users/users.service';
import { SessionsService, DeviceInfoInput } from '../sessions/sessions.service';
import { MfaAttemptsService } from '../mfa-attempts/mfa-attempts.service';
import { MailService } from '../mail/mail.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ALL_MFA_METHODS, MfaMethod, getEnabledMethods, verifiersFor } from '../common/utils/mfa-methods.util';

const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;
const MFA_LOGIN_LOCKOUT_TTL_SECONDS = 15 * 60;
const MFA_ENABLE_LOCKOUT_TTL_SECONDS = 15 * 60;
const MFA_STEPUP_LOCKOUT_TTL_SECONDS = 15 * 60;
const MFA_EMAIL_CODE_TTL_SECONDS = 10 * 60;
const MFA_SETUP_REQUIRED_TTL = '15m';
const PASSWORD_RESET_LOCKOUT_TTL_SECONDS = 15 * 60;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const ANONYMOUS_ACTOR_ID = '000000000000000000000000';
const DUMMY_PASSWORD_HASH = '$2b$10$a5nY6bYAKZgCKV7w/LWFJeDEnsM34MzXGyyUzBwKkTNykFMz7IXFS';

// PIN ທີ່ຜູ້ໃຊ້ຕັ້ງເອງ: ຕົວເລກ 6–8 ຫຼັກ (ປ່ຽນໄດ້ທີ່ນີ້ + regex ໃນ setup-mfa.dto.ts)
const PIN_PATTERN = /^\d{6,8}$/;

// ປະຕິເສດ PIN ທີ່ເດົາງ່າຍເກີນໄປ: ເລກຊ້ຳທັງໝົດ (111111) ແລະ ເລກລຽງຕິດກັນ (123456 / 654321)
function pinProblem(pin: string): string | null {
    if (!PIN_PATTERN.test(pin)) return 'PIN must be 6-8 digits';
    if (/^(\d)\1+$/.test(pin)) return 'PIN is too easy to guess (all the same digit)';
    const d = pin.split('').map(Number);
    const step = d[1] - d[0];
    if ((step === 1 || step === -1) && d.every((n, i) => i === 0 || n - d[i - 1] === step)) {
        return 'PIN is too easy to guess (a straight sequence)';
    }
    return null;
}

const METHOD_LABEL: Record<MfaMethod, string> = {
    email: 'email code',
    pin: 'personal PIN',
    totp: 'authenticator app',
};

@Injectable()
export class AuthService {
    constructor(
        private usersService: UsersService,
        private jwtService: JwtService,
        private sessionsService: SessionsService,
        private mfaAttemptsService: MfaAttemptsService,
        private mailService: MailService,
        private auditLogsService: AuditLogsService,
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

    // ກວດລະຫັດ/PIN ຂອງວິທີໃດວິທີໜຶ່ງ. `user` ຕ້ອງເປັນ document ທີ່ມີ secret / pinHash (ບໍ່ແມ່ນ JSON)
    private async checkMfaCode(user: any, method: MfaMethod, code: string, emailCodeKey: string): Promise<boolean> {
        if (method === 'email') {
            const valid = await this.mfaAttemptsService.verifyCode(emailCodeKey, this.hashCode(code));
            if (valid) await this.mfaAttemptsService.reset(emailCodeKey);
            return valid;
        }
        if (method === 'pin') {
            if (!user.mfa?.pinHash) return false;
            return bcrypt.compare(code, user.mfa.pinHash);
        }
        if (!user.mfa?.secret) return false;
        const result = await verify({ secret: user.mfa.secret, token: code });
        return result.valid;
    }

    // ໃຊ້ໃນໜ້າ Settings: ຫ້າມຖິ້ມ 401 (frontend ຈະ logout ອັດຕະໂນມັດ) ຈຶ່ງແປງເປັນ 429
    private async assertNotLockedOutHttp(key: string) {
        try {
            await this.mfaAttemptsService.assertNotLockedOut(key);
        } catch {
            throw new HttpException('Too many failed attempts — please try again later', HttpStatus.TOO_MANY_REQUESTS);
        }
    }

    async login(email: string, password: string, deviceInfo: DeviceInfoInput) {
        const user = await this.usersService.findByEmail(email);
        if (!user) {
            await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
            await this.auditLogsService.log(
                ANONYMOUS_ACTOR_ID,
                'LOGIN_FAILED',
                'User',
                email,
                undefined,
                { email, reason: 'unknown_email' },
                deviceInfo.ip,
            );
            throw new UnauthorizedException('Invalid credentials');
        }

        if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
            await this.auditLogsService.log(
                String(user._id),
                'LOGIN_BLOCKED',
                'User',
                String(user._id),
                undefined,
                { email: user.email, reason: 'locked' },
                deviceInfo.ip,
            );
            throw new UnauthorizedException('ບັນຊີຖືກລັອກຊົ່ວຄາວ ເນື່ອງຈາກໃສ່ລະຫັດຜ່ານຜິດຫຼາຍເທື່ອ — ກະລຸນາລອງໃໝ່ພາຍຫຼັງ');
        }

        const passwordMatches = await bcrypt.compare(password, user.passwordHash);
        if (!passwordMatches) {
            const { locked } = await this.usersService.recordLoginFailure(
                String(user._id),
                MAX_LOGIN_ATTEMPTS,
                LOGIN_LOCKOUT_MS,
            );
            await this.auditLogsService.log(
                String(user._id),
                locked ? 'LOGIN_LOCKED' : 'LOGIN_FAILED',
                'User',
                String(user._id),
                undefined,
                { email: user.email, reason: 'bad_password' },
                deviceInfo.ip,
            );
            if (locked) {
                throw new UnauthorizedException('ໃສ່ລະຫັດຜິດຫຼາຍເທື່ອ — ບັນຊີຖືກລັອກຊົ່ວຄາວ 15 ນາທີ');
            }
            throw new UnauthorizedException('Invalid credentials');
        }

        if (!user.isActive) {
            await this.auditLogsService.log(
                String(user._id),
                'LOGIN_FAILED',
                'User',
                String(user._id),
                undefined,
                { email: user.email, reason: 'inactive' },
                deviceInfo.ip,
            );
            throw new UnauthorizedException('This account has been deactivated');
        }

        const methods = getEnabledMethods(user.mfa);
        if (methods.length > 0) {

            await this.mfaAttemptsService.assertNotLockedOut(`login:${user._id}`);

            const mfaToken = this.jwtService.sign(
                { sub: user._id, purpose: 'mfa_challenge' },
                { expiresIn: '5m' },
            );
            await this.mfaAttemptsService.createChallenge(mfaToken, MFA_CHALLENGE_TTL_SECONDS);

            // ມີວິທີດຽວ → ໃຊ້ເລີຍ (ຖ້າເປັນ email ກໍສົ່ງລະຫັດທັນທີ)
            if (methods.length === 1) {
                if (methods[0] === 'email') {
                    await this.issueAndSendEmailCode(`email-code:login:${user._id}`, user.email, user.firstName);
                }
                return { mfaRequired: true, mfaToken, mfaMethod: methods[0], mfaMethods: methods };
            }

            // ມີຫຼາຍວິທີ → ໃຫ້ຜູ້ໃຊ້ເລືອກເອງ (frontend ສະແດງໜ້າເລືອກ, ແລ້ວເອີ້ນ /auth/mfa/login/select)
            return { mfaRequired: true, mfaToken, mfaMethod: null, mfaMethods: methods };
        }

        const role = user.role as any;
        if (role?.mfaRequired) {
            const setupToken = this.jwtService.sign(
                { sub: user._id, purpose: 'mfa_setup_required' },
                { expiresIn: MFA_SETUP_REQUIRED_TTL },
            );
            await this.auditLogsService.log(
                String(user._id),
                'MFA_SETUP_REQUIRED',
                'User',
                String(user._id),
                undefined,
                { email: user.email, reason: 'role_requires_mfa' },
                deviceInfo.ip,
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
        await this.usersService.recordLoginSuccess(String(user._id));
        await this.auditLogsService.log(
            String(user._id),
            'LOGIN_SUCCESS',
            'User',
            String(user._id),
            undefined,
            { email: user.email, sessionId: String(session._id) },
            deviceInfo.ip,
        );

        return { accessToken: token };
    }

    // ---- MFA management (Settings page) ------------------------------------------

    async getMfaStatus(userId: string) {
        const user = await this.usersService.findOne(userId);
        const methods = getEnabledMethods(user.mfa);
        const verifiers: Record<string, MfaMethod[]> = {};
        for (const m of ALL_MFA_METHODS) verifiers[m] = verifiersFor(methods, m);
        return {
            enabled: methods.length > 0,
            methods,
            // verifiers[x] = ວິທີທີ່ໃຊ້ຢືນຢັນໄດ້ ກ່ອນເພີ່ມ/ປ່ຽນ/ປິດວິທີ x (ຫວ່າງ = ບໍ່ຕ້ອງຢືນຢັນ)
            verifiers,
            mfaRequired: !!(user.role as any)?.mfaRequired,
        };
    }

    // ຢືນຢັນຕົວຕົນກ່ອນແກ້ໄຂວິທີ `target` (ເບິ່ງກົດໃນ verifiersFor)
    private async assertStepUp(userId: string, target: MfaMethod, verifyMethod?: MfaMethod, verifyCode?: string) {
        const user = await this.usersService.findOneRaw(userId);
        const allowed = verifiersFor(getEnabledMethods(user.mfa), target);
        if (allowed.length === 0) return;

        const allowedText = allowed.map((m) => METHOD_LABEL[m]).join(' or ');
        if (!verifyMethod || !verifyCode) {
            throw new BadRequestException(`Verification required — confirm with your ${allowedText}`);
        }
        if (!allowed.includes(verifyMethod)) {
            throw new BadRequestException(`This change must be verified with your ${allowedText}`);
        }

        const lockoutKey = `stepup:${userId}`;
        await this.assertNotLockedOutHttp(lockoutKey);

        const ok = await this.checkMfaCode(user, verifyMethod, verifyCode, `email-code:stepup:${userId}`);
        if (!ok) {
            await this.mfaAttemptsService.recordFailure(lockoutKey, MFA_STEPUP_LOCKOUT_TTL_SECONDS);
            throw new BadRequestException('Invalid verification code');
        }
        await this.mfaAttemptsService.reset(lockoutKey);
    }

    async sendStepUpEmailCode(userId: string, target: MfaMethod) {
        const user = await this.usersService.findOneRaw(userId);
        const allowed = verifiersFor(getEnabledMethods(user.mfa), target);
        if (!allowed.includes('email')) {
            throw new BadRequestException('Email verification is not available for this change');
        }
        await this.assertNotLockedOutHttp(`stepup:${userId}`);
        await this.issueAndSendEmailCode(`email-code:stepup:${userId}`, user.email, user.firstName);
        return { codeSent: true };
    }

    async setupMfa(
        userId: string,
        method: MfaMethod,
        pin?: string,
        confirmPin?: string,
        verifyMethod?: MfaMethod,
        verifyCode?: string,
        forcedSetup = false,
    ) {
        const user = await this.usersService.findOneRaw(userId);

        if (forcedSetup && method !== 'email') {
            throw new BadRequestException('ການຕັ້ງຄ່າ MFA ຄັ້ງທຳອິດຕ້ອງຢືນຢັນດ້ວຍອີເມວກ່ອນ — ຕັ້ງຄ່າອີເມວໃຫ້ສຳເລັດ ແລ້ວຄ່ອຍເພີ່ມ PIN ຫຼືແອັບ Authenticator ໃນໜ້າຕັ້ງຄ່າ');
        }

        if (method === 'email' && getEnabledMethods(user.mfa).includes('email')) {
            throw new BadRequestException('Email MFA is already enabled');
        }

        // ກວດຮູບແບບ PIN ກ່ອນ ເພື່ອບໍ່ເສຍລະຫັດຢືນຢັນຟຣີ
        if (method === 'pin') {
            if (!pin || pin !== confirmPin) {
                throw new BadRequestException('PIN and confirmation do not match');
            }
            const problem = pinProblem(pin);
            if (problem) throw new BadRequestException(problem);
        }

        await this.assertStepUp(userId, method, verifyMethod, verifyCode);

        if (method === 'pin') {
            await this.usersService.setPendingMfaPin(userId, await bcrypt.hash(pin as string, 10));
            return { method: 'pin', pinSet: true };
        }

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
        } else if (pendingMethod === 'pin') {
            if (!user.mfa?.pendingPinHash) {
                throw new BadRequestException('Call /auth/mfa/setup with your PIN first before enabling it');
            }
            valid = await bcrypt.compare(code, user.mfa.pendingPinHash);
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

        const updated = await this.usersService.confirmMfaEnabled(userId);
        const methods = getEnabledMethods(updated.mfa);

        await this.auditLogsService.log(
            String(userId),
            'MFA_ENABLED',
            'User',
            String(userId),
            undefined,
            { method: pendingMethod, methods },
            deviceInfo?.ip,
        );

        if (deviceInfo) {
            const fullUser = await this.usersService.findOne(userId);
            const loginResult = await this.completeLogin(fullUser, deviceInfo);
            return { enabled: true, methods, ...loginResult };
        }

        return { enabled: true, methods };
    }

    async disableMfa(userId: string, method: MfaMethod, verifyMethod?: MfaMethod, verifyCode?: string) {
        const user = await this.usersService.findOne(userId);
        const methods = getEnabledMethods(user.mfa);
        if (!methods.includes(method)) {
            throw new BadRequestException('This MFA method is not enabled');
        }
        if (methods.length === 1 && (user.role as any)?.mfaRequired) {
            throw new BadRequestException('Your role requires MFA — add another method before turning this one off');
        }

        await this.assertStepUp(userId, method, verifyMethod, verifyCode);

        const updated = await this.usersService.removeMfaMethod(userId, method);
        const remaining = getEnabledMethods(updated.mfa);
        await this.auditLogsService.log(
            String(userId),
            'MFA_DISABLED',
            'User',
            String(userId),
            { method },
            { methods: remaining },
            undefined,
        );
        return { disabled: true, methods: remaining };
    }

    // ---- MFA at login ---------------------------------------------------------------

    private readChallengeToken(mfaToken: string) {
        let payload: any;
        try {
            payload = this.jwtService.verify(mfaToken);
        } catch {
            throw new UnauthorizedException('MFA challenge token is invalid or expired — please log in again');
        }
        if (payload.purpose !== 'mfa_challenge') {
            throw new UnauthorizedException('Invalid token for this operation');
        }
        return payload;
    }

    // ຜູ້ໃຊ້ມີຫຼາຍວິທີ ແລະ ເລືອກວິທີທີ່ຈະໃຊ້ລັອກອິນຄັ້ງນີ້ — ຖ້າເລືອກ email ຈະສົ່ງລະຫັດໃຫ້ທັນທີ
    async selectLoginMethod(mfaToken: string, method: MfaMethod) {
        const payload = this.readChallengeToken(mfaToken);
        const tokenKey = this.mfaAttemptsService.hashKey(mfaToken);
        await this.mfaAttemptsService.assertNotConsumed(tokenKey);
        await this.mfaAttemptsService.assertNotLockedOut(`login:${payload.sub}`);

        const user = await this.usersService.findOne(payload.sub);
        if (!user) throw new NotFoundException('User not found');
        if (!getEnabledMethods(user.mfa).includes(method)) {
            throw new BadRequestException('This MFA method is not enabled for this account');
        }

        if (method === 'email') {
            await this.issueAndSendEmailCode(`email-code:login:${user._id}`, user.email, user.firstName);
        }
        return { method };
    }

    async verifyMfaLogin(mfaToken: string, code: string, deviceInfo: DeviceInfoInput, method?: MfaMethod) {
        const payload = this.readChallengeToken(mfaToken);

        const tokenKey = this.mfaAttemptsService.hashKey(mfaToken);
        const lockoutKey = `login:${payload.sub}`;

        await this.mfaAttemptsService.assertNotConsumed(tokenKey);
        await this.mfaAttemptsService.assertNotLockedOut(lockoutKey);

        const user = await this.usersService.findOne(payload.sub);
        if (!user) throw new NotFoundException('User not found');

        const methods = getEnabledMethods(user.mfa);
        const chosen = method ?? (methods.length === 1 ? methods[0] : undefined);
        if (!chosen) {
            throw new BadRequestException('Choose an MFA method first');
        }
        if (!methods.includes(chosen)) {
            throw new BadRequestException('This MFA method is not enabled for this account');
        }

        const valid = await this.checkMfaCode(user, chosen, code, `email-code:login:${user._id}`);

        if (!valid) {
            await this.mfaAttemptsService.recordFailure(lockoutKey, MFA_LOGIN_LOCKOUT_TTL_SECONDS);
            throw new UnauthorizedException('Invalid MFA code');
        }

        await this.mfaAttemptsService.markConsumed(tokenKey);
        await this.mfaAttemptsService.reset(lockoutKey);
        return this.completeLogin(user, deviceInfo);
    }

    async resendLoginEmailCode(mfaToken: string) {
        const payload = this.readChallengeToken(mfaToken);

        const tokenKey = this.mfaAttemptsService.hashKey(mfaToken);
        const lockoutKey = `login:${payload.sub}`;
        await this.mfaAttemptsService.assertNotConsumed(tokenKey);
        await this.mfaAttemptsService.assertNotLockedOut(lockoutKey);

        const user = await this.usersService.findOne(payload.sub);
        if (!user) throw new NotFoundException('User not found');
        if (!getEnabledMethods(user.mfa).includes('email')) {
            throw new BadRequestException('This account is not using email MFA');
        }

        await this.issueAndSendEmailCode(`email-code:login:${user._id}`, user.email, user.firstName);
        return { codeSent: true };
    }

    // ---- Forgot / reset password -------------------------------------------------
    // ສົ່ງລະຫັດ 6 ຫຼັກໄປອີເມວ. ຕອບຄືກັນສະເໝີ (ບໍ່ວ່າອີເມວມີໃນລະບົບຫຼືບໍ່) ເພື່ອບໍ່ໃຫ້ເດົາໄດ້ວ່າໃຜມີບັນຊີ
    async forgotPassword(rawEmail: string) {
        const email = rawEmail.trim().toLowerCase();
        const user = await this.usersService.findByEmail(email);
        if (user && user.isActive) {
            await this.issueAndSendEmailCode(`email-code:reset:${user._id}`, user.email, user.firstName);
        }
        return { sent: true };
    }

    async resetPassword(rawEmail: string, code: string, newPassword: string, mfaCode?: string) {
        const email = rawEmail.trim().toLowerCase();
        const lockoutKey = `reset:${this.mfaAttemptsService.hashKey(email)}`;
        await this.mfaAttemptsService.assertNotLockedOut(lockoutKey);

        const invalid = async () => {
            await this.mfaAttemptsService.recordFailure(lockoutKey, PASSWORD_RESET_LOCKOUT_TTL_SECONDS);
            throw new BadRequestException('Invalid or expired code');
        };

        const user = await this.usersService.findByEmail(email);
        if (!user || !user.isActive) return invalid();

        const codeKey = `email-code:reset:${user._id}`;
        const emailOk = await this.mfaAttemptsService.verifyCode(codeKey, this.hashCode(code));
        if (!emailOk) return invalid();

        // ຖ້າບັນຊີເປີດໃຊ້ MFA ແຕ່ "ບໍ່ມີ email" ເປັນໜຶ່ງໃນວິທີ ຕ້ອງໃສ່ PIN / ລະຫັດ Authenticator ນຳ
        // — ບໍ່ດັ່ງນັ້ນຜູ້ທີ່ເຂົ້າອີເມວໄດ້ຈະຂ້າມ MFA ໄດ້. ຖ້າ email ເປັນໜຶ່ງໃນວິທີ ລະຫັດອີເມວຂ້າງເທິງກໍພໍແລ້ວ
        // (ເທົ່າກັບຕອນລັອກອິນທີ່ ໃຊ້ email ວິທີດຽວກໍເຂົ້າໄດ້)
        const methods = getEnabledMethods(user.mfa);
        if (methods.length > 0 && !methods.includes('email')) {
            if (!mfaCode) return invalid();
            const raw = await this.usersService.findOneRaw(String(user._id));
            let mfaOk = false;
            for (const m of methods) {
                if (await this.checkMfaCode(raw, m, mfaCode, '')) { mfaOk = true; break; }
            }
            if (!mfaOk) return invalid();
        }

        const passwordHash = await bcrypt.hash(newPassword, 10);
        await this.usersService.setPasswordHash(String(user._id), passwordHash);

        await this.mfaAttemptsService.reset(codeKey);
        await this.mfaAttemptsService.reset(lockoutKey);
        // ອອກຈາກລະບົບທຸກອຸປະກອນ — ຖ້າມີຄົນອື່ນຮູ້ລະຫັດເກົ່າຢູ່ ຈະຖືກເຕະອອກ
        await this.sessionsService.revokeAllForUser(String(user._id));

        await this.auditLogsService.log(
            String(user._id),
            'PASSWORD_RESET',
            'User',
            String(user._id),
            undefined,
            { email: user.email },
            undefined,
        );

        return { reset: true };
    }
}
