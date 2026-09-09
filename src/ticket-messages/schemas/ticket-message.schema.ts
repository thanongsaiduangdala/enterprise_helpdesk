import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TicketMessageDocument = TicketMessage & Document;

@Schema({ timestamps: true })
export class TicketMessage {
    @Prop({ type: String, ref: 'Ticket', required: true })
    ticketId!: string;

    @Prop({ type: Types.ObjectId, ref: 'User', required: true })
    senderId!: Types.ObjectId;

    @Prop({ required: true })
    body!: string;

    @Prop({ type: [String], default: [] })
    attachments!: string[];

    @Prop({ default: false })
    isCannedResponse!: boolean;

    @Prop({ type: String, ref: 'CannedResponse' })
    cannedResponseId?: string;
}

export const TicketMessageSchema = SchemaFactory.createForClass(TicketMessage);
TicketMessageSchema.index({ ticketId: 1, createdAt: 1 });