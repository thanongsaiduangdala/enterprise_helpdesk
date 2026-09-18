import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { OrganizationSettingsService } from '../settings/organization-settings.service';

@Injectable()
export class MailService {
    private readonly logger = new Logger(MailService.name);

    constructor(
        private configService: ConfigService,
        private orgSettingsService: OrganizationSettingsService,
    ) { }

    // ສ້າງ transporter ຕາມການຕັ້ງຄ່າອົງກອນ (SMTP) — ແຕ່ລະຄັ້ງທີ່ສົ່ງ:
    // 1) ຖ້າມີ SMTP ໃສ່ໄວ້ໃນການຕັ້ງຄ່າອົງກອນ → ໃຊ້ຕົວນັ້ນ
    // 2) ບໍ່ມີ → ຕົກເປັນໃຊ້ Gmail ຈາກ env (ຄ່າເກົ່າ)
    // ຊື່ຜູ້ສົ່ງ (from name) ໃຊ້ຈາກ smtp.fromName ຫຼື ຊື່ລະບົບຂອງອົງກອນ (email branding)
    async sendMail(to: string, subject: string, html: string, attachments?: nodemailer.SendMailOptions['attachments']) {
        try {
            const { transporter, from, displayName } = await this.resolveMailSource();
            await transporter.sendMail({
                from: `"${displayName}" <${from}>`,
                to,
                subject,
                html,
                attachments,
            });
            this.logger.log(`Email sent to ${to}: "${subject}"`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to send email to ${to}: "${subject}" — ${message}`);
        }
    }

    private async resolveMailSource() {
        const settings = await this.orgSettingsService.getSettings();
        const smtp = settings?.smtp;
        const systemName = settings?.systemName || 'Helpdesk Enterprise';

        if (smtp?.host) {
            return {
                transporter: nodemailer.createTransport({
                    host: smtp.host,
                    port: Number(smtp.port) || 587,
                    secure: Boolean(smtp.secure),
                    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
                }),
                from: smtp.fromEmail || smtp.user || '',
                displayName: smtp.fromName || systemName,
            };
        }

        const gmailUser = this.configService.get<string>('GMAIL_USER') || '';
        return {
            transporter: nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: gmailUser,
                    pass: this.configService.get<string>('GMAIL_APP_PASSWORD'),
                },
            }),
            from: gmailUser,
            displayName: systemName,
        };
    }
}