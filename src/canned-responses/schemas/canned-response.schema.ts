import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CannedResponseDocument = CannedResponse & Omit<Document, '_id'>;

@Schema({ timestamps: true })
export class CannedResponse {
    @Prop({ type: String })
    _id!: string; // e.g. 'CR001' — see CannedResponsesService.generateId() for the gap-filling logic

    @Prop({ type: String, ref: 'Department', required: true })
    departmentId!: string;

    @Prop({ required: true })
    title!: string;

    @Prop({ required: true })
    body!: string;

    @Prop({ type: Types.ObjectId, ref: 'User', required: true })
    createdBy!: Types.ObjectId;
}

export const CannedResponseSchema = SchemaFactory.createForClass(CannedResponse);
CannedResponseSchema.index({ departmentId: 1 });
