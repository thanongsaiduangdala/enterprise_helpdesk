import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
    private readonly logger = new Logger(MailService.name);
    private transporter: nodemailer.Transporter;

    constructor(private configService: ConfigService) {
        this.transporter = nodemailer.createTransport({
            service: 'gmail', // shorthand — nodemailer already knows Gmail's host/port/TLS settings
            auth: {
                user: this.configService.get<string>('GMAIL_USER'),
                pass: this.configService.get<string>('GMAIL_APP_PASSWORD'),
            },
        });
    }

    // Generic send — other features (invite emails, password reset, etc.) can reuse this
    // directly rather than each building their own transporter.
    async sendMail(to: string, subject: string, html: string, attachments?: nodemailer.SendMailOptions['attachments']) {
        try {
            await this.transporter.sendMail({
                from: this.configService.get<string>('GMAIL_USER'),
                to,
                subject,
                html,
                attachments,
            });
            this.logger.log(`Email sent to ${to}: "${subject}"`);
        } catch (error) {
            // Swallow the error rather than throwing — a failed digest email shouldn't
            // crash whatever scheduled job triggered it. Just log it clearly so it's
            // visible in server logs / can be investigated.
            this.logger.error(`Failed to send email to ${to}: "${subject}"`, error as Error);
        }
    }
}
