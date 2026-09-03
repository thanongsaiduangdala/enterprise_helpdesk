import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';


export type TicketMessageDocument = TicketMessage & Omit<Document, '_id'>;

@Schema({ timestamps: true })
export class TicketMessage {
    @Prop({ type: String })
    _id!: string; // e.g. 'TM001' — see TicketMessagesService.generateId() for the gap-filling logic

    @Prop({ type: String, ref: 'Ticket', required: true })
    ticketId!: string;

    @Prop({ type: Types.ObjectId, ref: 'User', required: true })
    senderId!: Types.ObjectId;

    @Prop({ required: true })
    body!: string;

    @Prop({ type: [String], default: [] })
    attachments!: string[]; // S3 file URLs/keys

    @Prop({ default: false })
    isCannedResponse!: boolean;

    // References CannedResponse, which uses the custom 'CR001' string ID, not an ObjectId.
    @Prop({ type: String, ref: 'CannedResponse' })
    cannedResponseId?: string;
}

export const TicketMessageSchema = SchemaFactory.createForClass(TicketMessage);
// Speeds up loading a ticket's full message timeline in order.
TicketMessageSchema.index({ ticketId: 1, createdAt: 1 });
