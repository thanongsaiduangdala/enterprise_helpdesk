import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth } from '@nestjs/swagger';
import { UAParser } from 'ua-parser-js';
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { MfaCodeDto } from "./dto/mfa-code.dto";
import { MfaVerifyLoginDto } from "./dto/mfa-verify-login.dto";
import { JwtAuthGuard } from "./jwt-auth.guard";

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
    login(@Body() dto: LoginDto, @Req() req: any) {
        return this.authService.login(dto.email, dto.password, extractDeviceInfo(req));
    }

    @Post('mfa/setup')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    setupMfa(@Req() req: any) {
        return this.authService.setupMfa(req.user.userId);
    }

    @Post('mfa/enable')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    enableMfa(@Body() dto: MfaCodeDto, @Req() req: any) {
        return this.authService.enableMfa(req.user.userId, dto.code);
    }

    @Post('mfa/verify-login')
    verifyMfaLogin(@Body() dto: MfaVerifyLoginDto, @Req() req: any) {
        return this.authService.verifyMfaLogin(dto.mfaToken, dto.code, extractDeviceInfo(req));
    }
}
