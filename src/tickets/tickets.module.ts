import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Ticket, TicketSchema } from './schemas/ticket.schema';
import { TicketsService } from './tickets.service';
import { TicketsController } from './tickets.controller';
import { TicketTypesModule } from '../ticket-types/ticket-type.module';
import { SlaPoliciesModule } from '../sla-policies/sla-policies.module';
import { DepartmentsModule } from '../departments/departments.module';
import { BranchesModule } from '../branches/branches.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: Ticket.name, schema: TicketSchema }]),
        TicketTypesModule,
        SlaPoliciesModule,
        DepartmentsModule,
        BranchesModule,
        NotificationsModule,
        AuditLogsModule,
    ],
    controllers: [TicketsController],
    providers: [TicketsService],
    exports: [TicketsService],
})
export class TicketsModule { }
