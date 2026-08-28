import { Body, Controller, Post, Req } from "@nestjs/common";
import { UAParser } from 'ua-parser-js';
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";

@Controller('auth')
export class AuthController {
    constructor(private authService: AuthService) { }

    @Post('login')
    login(@Body() dto: LoginDto, @Req() req: any) {
        const parser = new UAParser(req.headers['user-agent']);
        const deviceInfo = {
            userAgent: req.headers['user-agent'],
            ip: req.ip,
            os: parser.getOS().name,
            browser: parser.getBrowser().name,
        };
        return this.authService.login(dto.email, dto.password, deviceInfo);
    }
}