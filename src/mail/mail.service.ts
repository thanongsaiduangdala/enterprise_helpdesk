import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
    private readonly logger = new Logger(MailService.name);
    private transporter: nodemailer.Transporter;

    constructor(private configService: ConfigService) {
        this.transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: this.configService.get<string>('GMAIL_USER'),
                pass: this.configService.get<string>('GMAIL_APP_PASSWORD'),
            },
        });
    }



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



            this.logger.error(`Failed to send email to ${to}: "${subject}"`, error as Error);
        }
    }
}
