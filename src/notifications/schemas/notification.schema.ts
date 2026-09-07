import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type NotificationDocument = Notification & Document;

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class Notification {
    @Prop({ type: Types.ObjectId, ref: 'User', required: true })
    userId!: Types.ObjectId;

    @Prop({ required: true })
    type!: string;



    @Prop({ required: true })
    refId!: string;

    @Prop({ required: true })
    refModel!: string;

    @Prop({ required: true })
    title!: string;

    @Prop({ required: true })
    body!: string;

    @Prop({ default: false })
    isRead!: boolean;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
NotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
