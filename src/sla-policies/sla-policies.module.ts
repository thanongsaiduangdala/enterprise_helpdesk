import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SlaPolicy, SlaPolicySchema } from './schemas/sla-policy.schema';
import { SlaPoliciesService } from './sla-policies.service';
import { SlaPoliciesController } from './sla-policies.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { TicketTypesModule } from '../ticket-types/ticket-type.module';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: SlaPolicy.name, schema: SlaPolicySchema }]),
        AuditLogsModule,
        TicketTypesModule,
    ],
    controllers: [SlaPoliciesController],
    providers: [SlaPoliciesService],
    exports: [SlaPoliciesService],
})
export class SlaPoliciesModule { }