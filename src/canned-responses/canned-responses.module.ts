import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CannedResponse, CannedResponseSchema } from './schemas/canned-response.schema';
import { CannedResponsesService } from './canned-responses.service';
import { CannedResponsesController } from './canned-responses.controller';
import { UsersModule } from '../users/users.module';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: CannedResponse.name, schema: CannedResponseSchema }]),
        UsersModule,
    ],
    controllers: [CannedResponsesController],
    providers: [CannedResponsesService],
    exports: [CannedResponsesService],
})
export class CannedResponsesModule { }