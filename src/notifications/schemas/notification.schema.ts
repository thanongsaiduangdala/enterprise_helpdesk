import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type NotificationDocument = Notification & Document;

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class Notification {
    @Prop({ type: Types.ObjectId, ref: 'User', required: true })
    userId!: Types.ObjectId;

    @Prop({ required: true })
    type!: string; // e.g. 'SLA_BREACH', 'TICKET_ASSIGNED', 'SUPPLY_APPROVED', 'ANNOUNCEMENT'

    // Polymorphic reference — refModel tells you which collection refId points into.
    // Kept as plain strings rather than a typed ref since it varies per notification type.
    @Prop({ required: true })
    refId!: string;

    @Prop({ required: true })
    refModel!: string; // e.g. 'Ticket', 'Announcement', 'SupplyRequest'

    @Prop({ required: true })
    title!: string;

    @Prop({ required: true })
    body!: string;

    @Prop({ default: false })
    isRead!: boolean;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
NotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
