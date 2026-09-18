import { Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { SettingsModule } from '../settings/organization-settings.module';

@Module({
    imports: [SettingsModule],
    providers: [MailService],
    exports: [MailService],
})
export class MailModule { }