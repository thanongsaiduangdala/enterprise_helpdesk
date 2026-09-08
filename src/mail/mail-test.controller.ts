import { Controller, Get, Query } from '@nestjs/common';
import { MailService } from './mail.service';




@Controller('mail-test')
export class MailTestController {
    constructor(private mailService: MailService) { }

    @Get()
    async test(@Query('to') to: string) {
        await this.mailService.sendMail(
            to,
            'Test email from Enterprise Helpdesk',
            '<p>If you are reading this, SMTP is working correctly.</p>',
        );
        return { sent: true, to };
    }
}
