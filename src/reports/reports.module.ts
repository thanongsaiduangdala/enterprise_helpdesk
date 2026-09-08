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
        // Registering the Ticket schema again here is safe — Mongoose/Nest just reuses
        // the same underlying model. Done this way (rather than importing TicketsModule)
        // so Reports can run its own aggregation queries directly without needing
        // TicketsService's business-logic methods.
        MongooseModule.forFeature([{ name: Ticket.name, schema: TicketSchema }]),
        RolesModule,
        UsersModule,
        MailModule,
    ],
    controllers: [ReportsController],
    providers: [ReportsService, ReportsDigestService],
})
export class ReportsModule { }
