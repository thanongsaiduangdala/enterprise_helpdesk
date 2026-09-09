import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MfaAttempt, MfaAttemptSchema } from './schemas/mfa-attempt.schema';
import { MfaAttemptsService } from './mfa-attempts.service';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: MfaAttempt.name, schema: MfaAttemptSchema }]),
    ],
    providers: [MfaAttemptsService],
    exports: [MfaAttemptsService],
})
export class MfaAttemptsModule { }
