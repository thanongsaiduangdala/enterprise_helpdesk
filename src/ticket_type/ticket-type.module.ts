import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TicketType, TicketTypeSchema } from './schemas/ticket-type.schema';
import { TicketTypesService } from './ticket-types.service';
import { TicketTypesController } from './ticket-types.controller';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: TicketType.name, schema: TicketTypeSchema }]),
    ],
    controllers: [TicketTypesController],
    providers: [TicketTypesService],
    exports: [TicketTypesService],
})
export class TicketTypesModule { }