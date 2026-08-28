import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SlaPolicy, SlaPolicySchema } from './schemas/sla-policy.schema';
import { SlaPoliciesService } from './sla-policies.service';
import { SlaPoliciesController } from './sla-policies.controller';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: SlaPolicy.name, schema: SlaPolicySchema }]),
    ],
    controllers: [SlaPoliciesController],
    providers: [SlaPoliciesService],
    exports: [SlaPoliciesService], // exported so TicketsModule can inject it later for the ticketType→SLA lookup
})
export class SlaPoliciesModule { }