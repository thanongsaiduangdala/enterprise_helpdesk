import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SessionDocument = Session & Document;

@Schema({ _id: false })
class DeviceInfo {
    @Prop()
    userAgent?: string;

    @Prop()
    ip?: string;

    @Prop()
    os?: string;

    @Prop()
    browser?: string;
}

@Schema()
export class Session {
    @Prop({ required: true })
    userId!: string;

    @Prop({ type: DeviceInfo, default: () => ({}) })
    deviceInfo!: DeviceInfo;

    @Prop({ required: true, default: () => new Date() })
    issuedAt!: Date;

    @Prop({ required: true, default: () => new Date() })
    lastSeenAt!: Date;

    @Prop({ required: true })
    expiresAt!: Date;

    @Prop({ default: false })
    revoked!: boolean;
}

export const SessionSchema = SchemaFactory.createForClass(Session);