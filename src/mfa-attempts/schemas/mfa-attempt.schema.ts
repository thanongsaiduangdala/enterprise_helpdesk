import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MfaAttemptDocument = MfaAttempt & Document;

@Schema()
export class MfaAttempt {


    @Prop({ required: true, unique: true })
    key!: string;

    @Prop({ default: 0 })
    failureCount!: number;

    @Prop()
    codeHash?: string;

    @Prop({ default: false })
    consumed!: boolean;

    @Prop({ required: true })
    expiresAt!: Date;
}

export const MfaAttemptSchema = SchemaFactory.createForClass(MfaAttempt);
MfaAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
