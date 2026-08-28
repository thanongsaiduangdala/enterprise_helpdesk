import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TicketTypeDocument = TicketType & Omit<Document, '_id'>;

@Schema({ timestamps: true })
export class TicketType {
    @Prop({ type: String })
    _id!: string;

    @Prop({ required: true, unique: true })
    name!: string; // e.g. 'VPN Access Issue'

    @Prop({ required: true })
    defaultDepartmentId!: string;

    @Prop({ enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' })
    defaultPriority!: string;

    @Prop()
    defaultSlaPolicyId?: string;

    @Prop()
    description?: string;

    @Prop({ default: true })
    isActive!: boolean;
}

export const TicketTypeSchema = SchemaFactory.createForClass(TicketType);