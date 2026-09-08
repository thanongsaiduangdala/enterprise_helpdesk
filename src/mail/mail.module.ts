import { Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { MailTestController } from './mail-test.controller';

@Module({
    controllers: [MailTestController], // TEMPORARY — remove once tested
    providers: [MailService],
    exports: [MailService],
})
export class MailModule { }