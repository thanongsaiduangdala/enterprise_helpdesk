import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Ticket, TicketSchema } from './schemas/ticket.schema';
import { TicketsService } from './tickets.service';
import { TicketsController } from './tickets.controller';
import { SlaMonitorService } from './sla-monitor.service';
import { TicketTypesModule } from '../ticket-types/ticket-type.module';
import { BranchesModule } from '../branches/branches.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { SlaPoliciesModule } from '../sla-policies/sla-policies.module';
import { DepartmentsModule } from '../departments/departments.module';
import { RolesModule } from '../roles/roles.module';
import { UsersModule } from '../users/users.module';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: Ticket.name, schema: TicketSchema }]),
        TicketTypesModule,
        SlaPoliciesModule,
        DepartmentsModule,
        BranchesModule,
        NotificationsModule,
        AuditLogsModule,
        RolesModule,
        UsersModule,
    ],
    controllers: [TicketsController],
    providers: [TicketsService, SlaMonitorService],
    exports: [TicketsService],
})
export class TicketsModule { }