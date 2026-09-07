import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TicketMessage, TicketMessageSchema } from './schemas/ticket-message.schema';
import { TicketMessagesService } from './ticket-messages.service';
import { TicketMessagesController } from './ticket-messages.controller';
import { CannedResponsesModule } from '../canned-responses/canned-responses.module';
import { TicketsModule } from '../tickets/tickets.module';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: TicketMessage.name, schema: TicketMessageSchema }]),
        CannedResponsesModule,
        TicketsModule,
    ],
    controllers: [TicketMessagesController],
    providers: [TicketMessagesService],
    exports: [TicketMessagesService],
})
export class TicketMessagesModule { }