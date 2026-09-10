import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Ticket, TicketSchema } from '../tickets/schemas/ticket.schema';
import { Department, DepartmentSchema } from '../departments/schemas/department.schema';
import { Branch, BranchSchema } from '../branches/schemas/branch.schema';
import { TicketType, TicketTypeSchema } from '../ticket-types/schemas/ticket-type.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { ReportsService } from './reports.service';
import { ReportsDigestService } from './reports-digest.service';
import { ReportsController } from './reports.controller';
import { RolesModule } from '../roles/roles.module';
import { UsersModule } from '../users/users.module';
import { MailModule } from '../mail/mail.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Ticket.name, schema: TicketSchema },
            { name: Department.name, schema: DepartmentSchema },
            { name: Branch.name, schema: BranchSchema },
            { name: TicketType.name, schema: TicketTypeSchema },
            { name: User.name, schema: UserSchema },
        ]),
        RolesModule,
        UsersModule,
        MailModule,
    ],
    controllers: [ReportsController],
    providers: [ReportsService, ReportsDigestService],
})
export class ReportsModule { }