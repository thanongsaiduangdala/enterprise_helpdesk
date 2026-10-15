import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UAParser } from 'ua-parser-js';
import { AuthService } from "./auth.service";
import { UsersService } from "../users/users.service";
import { LoginDto } from "./dto/login.dto";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { MfaCodeDto } from "./dto/mfa-code.dto";
import { MfaVerifyLoginDto } from "./dto/mfa-verify-login.dto";
import { SetupMfaDto } from "./dto/setup-mfa.dto";
import { ResendMfaCodeDto } from "./dto/resend-mfa-code.dto";
import { DisableMfaDto } from "./dto/disable-mfa.dto";
import { StepUpSendCodeDto } from "./dto/step-up-send-code.dto";
import { SelectMfaMethodDto } from "./dto/select-mfa-method.dto";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { MfaSetupGuard } from "./mfa-setup.guard";

function extractDeviceInfo(req: any) {
    const parser = new UAParser(req.headers['user-agent']);
    return {
        userAgent: req.headers['user-agent'],
        ip: req.ip,
        os: parser.getOS().name,
        browser: parser.getBrowser().name,
    };
}

@Controller('auth')
export class AuthController {
    constructor(
        private authService: AuthService,
        private usersService: UsersService,
    ) { }

    @Post('login')
    @Throttle({ default: { limit: 10, ttl: 60000 } })
    login(@Body() dto: LoginDto, @Req() req: any) {
        return this.authService.login(dto.email, dto.password, extractDeviceInfo(req));
    }

    @Post('forgot-password')
    @Throttle({ default: { limit: 3, ttl: 60000 } })
    forgotPassword(@Body() dto: ForgotPasswordDto) {
        return this.authService.forgotPassword(dto.email);
    }

    @Post('reset-password')
    @Throttle({ default: { limit: 5, ttl: 60000 } })
    resetPassword(@Body() dto: ResetPasswordDto) {
        return this.authService.resetPassword(dto.email, dto.code, dto.newPassword, dto.mfaCode);
    }

    // Lightweight "who am I" endpoint — any authenticated user can read their
    // own profile here, regardless of the 'users:read' permission (that one
    // gates *other* people's profiles via GET /users/:id).
    @Get('me')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    me(@Req() req: any) {
        return this.usersService.findOne(req.user.userId);
    }



    // ວິທີ MFA ທີ່ເປີດຢູ່ + ກົດວ່າຕ້ອງຢືນຢັນດ້ວຍວິທີໃດກ່ອນແກ້ໄຂແຕ່ລະວິທີ
    @Get('mfa/status')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    mfaStatus(@Req() req: any) {
        return this.authService.getMfaStatus(req.user.userId);
    }

    // ສົ່ງລະຫັດອີເມວເພື່ອຢືນຢັນກ່ອນເພີ່ມ/ປ່ຽນ/ປິດວິທີ MFA
    @Post('mfa/step-up/send-code')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @Throttle({ default: { limit: 3, ttl: 60000 } })
    sendStepUpCode(@Body() dto: StepUpSendCodeDto, @Req() req: any) {
        return this.authService.sendStepUpEmailCode(req.user.userId, dto.target);
    }

    @Post('mfa/setup')
    @UseGuards(MfaSetupGuard)
    @ApiBearerAuth()
    setupMfa(@Body() dto: SetupMfaDto, @Req() req: any) {
        return this.authService.setupMfa(
            req.user.userId,
            dto.method,
            dto.pin,
            dto.confirmPin,
            dto.verifyMethod,
            dto.verifyCode,
        );
    }

    @Post('mfa/disable')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @Throttle({ default: { limit: 5, ttl: 60000 } })
    disableMfa(@Body() dto: DisableMfaDto, @Req() req: any) {
        return this.authService.disableMfa(req.user.userId, dto.method, dto.verifyMethod, dto.verifyCode);
    }

    @Post('mfa/resend-code')
    @UseGuards(MfaSetupGuard)
    @ApiBearerAuth()
    @Throttle({ default: { limit: 3, ttl: 60000 } })
    resendSetupCode(@Req() req: any) {
        return this.authService.resendSetupEmailCode(req.user.userId);
    }

    @Post('mfa/enable')
    @UseGuards(MfaSetupGuard)
    @ApiBearerAuth()
    @Throttle({ default: { limit: 5, ttl: 60000 } })
    enableMfa(@Body() dto: MfaCodeDto, @Req() req: any) {




        const isForcedSetupFlow = req.user.purpose === 'mfa_setup_required';
        return this.authService.enableMfa(
            req.user.userId,
            dto.code,
            isForcedSetupFlow ? extractDeviceInfo(req) : undefined,
        );
    }

    @Post('mfa/verify-login')
    @Throttle({ default: { limit: 5, ttl: 60000 } })
    verifyMfaLogin(@Body() dto: MfaVerifyLoginDto, @Req() req: any) {
        return this.authService.verifyMfaLogin(dto.mfaToken, dto.code, extractDeviceInfo(req), dto.method);
    }

    // ຜູ້ໃຊ້ທີ່ມີຫຼາຍວິທີ MFA ເລືອກວິທີທີ່ຈະໃຊ້ (email ຈະສົ່ງລະຫັດທັນທີ)
    @Post('mfa/login/select')
    @Throttle({ default: { limit: 5, ttl: 60000 } })
    selectLoginMethod(@Body() dto: SelectMfaMethodDto) {
        return this.authService.selectLoginMethod(dto.mfaToken, dto.method);
    }

    @Post('mfa/login/resend-code')
    @Throttle({ default: { limit: 3, ttl: 60000 } })
    resendLoginCode(@Body() dto: ResendMfaCodeDto) {
        return this.authService.resendLoginEmailCode(dto.mfaToken);
    }
}
