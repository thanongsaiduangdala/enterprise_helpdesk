import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UAParser } from 'ua-parser-js';
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { MfaCodeDto } from "./dto/mfa-code.dto";
import { MfaVerifyLoginDto } from "./dto/mfa-verify-login.dto";
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
    constructor(private authService: AuthService) { }

    @Post('login')
    @Throttle({ default: { limit: 10, ttl: 60000 } })
    login(@Body() dto: LoginDto, @Req() req: any) {
        return this.authService.login(dto.email, dto.password, extractDeviceInfo(req));
    }



    @Post('mfa/setup')
    @UseGuards(MfaSetupGuard)
    @ApiBearerAuth()
    setupMfa(@Req() req: any) {
        return this.authService.setupMfa(req.user.userId);
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
        return this.authService.verifyMfaLogin(dto.mfaToken, dto.code, extractDeviceInfo(req));
    }
}
