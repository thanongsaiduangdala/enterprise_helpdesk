import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CannedResponse, CannedResponseSchema } from './schemas/canned-response.schema';
import { CannedResponsesService } from './canned-responses.service';
import { CannedResponsesController } from './canned-responses.controller';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: CannedResponse.name, schema: CannedResponseSchema }]),
    ],
    controllers: [CannedResponsesController],
    providers: [CannedResponsesService],
    exports: [CannedResponsesService], // exported so TicketMessagesModule can validate cannedResponseId on insert
})
export class CannedResponsesModule { }
