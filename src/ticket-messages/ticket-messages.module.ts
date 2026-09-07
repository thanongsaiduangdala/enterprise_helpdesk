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
        CannedResponsesModule, // one-directional — needed to validate cannedResponseId on create
        TicketsModule, // one-directional — needed to validate ticketId exists on create
    ],
    controllers: [TicketMessagesController],
    providers: [TicketMessagesService],
    exports: [TicketMessagesService],
})
export class TicketMessagesModule { }