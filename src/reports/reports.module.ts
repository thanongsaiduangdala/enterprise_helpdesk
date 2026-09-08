import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Ticket, TicketSchema } from '../tickets/schemas/ticket.schema';
import { ReportsService } from './reports.service';
import { ReportsDigestService } from './reports-digest.service';
import { ReportsController } from './reports.controller';
import { RolesModule } from '../roles/roles.module';
import { UsersModule } from '../users/users.module';
import { MailModule } from '../mail/mail.module';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: Ticket.name, schema: TicketSchema }]),
        RolesModule,
        UsersModule,
        MailModule,
    ],
    controllers: [ReportsController],
    providers: [ReportsService, ReportsDigestService],
})
export class ReportsModule { }
