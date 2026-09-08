import { Controller, Get, Query } from '@nestjs/common';
import { MailService } from './mail.service';

// TEMPORARY — delete this file once email sending is confirmed working.
// Deliberately has NO guards/permissions, since it's just for local testing.
// Do not leave this in place once you move toward any real deployment.
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
