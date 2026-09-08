import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AuditLogDocument = AuditLog & Document;

@Schema({ timestamps: false })
export class AuditLog {
    @Prop({ type: Types.ObjectId, ref: 'User', required: true })
    actorId!: Types.ObjectId;

    @Prop({ required: true })
    action!: string;

    @Prop({ required: true })
    entityType!: string;



    @Prop({ required: true })
    entityId!: string;

    @Prop({ type: Object })
    before?: Record<string, any>;

    @Prop({ type: Object })
    after?: Record<string, any>;

    @Prop()
    ip?: string;

    @Prop({ required: true })
    timestamp!: Date;




    @Prop({ required: true })
    hash!: string;

    @Prop({ required: true })
    prevHash!: string;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ actorId: 1, timestamp: -1 });
AuditLogSchema.index({ entityType: 1, entityId: 1 });
AuditLogSchema.index({ timestamp: -1 });
