import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AuditLogDocument = AuditLog & Document;

@Schema({ timestamps: false }) // 'timestamp' below is the authoritative time — see AuditLogsService
export class AuditLog {
    @Prop({ type: Types.ObjectId, ref: 'User', required: true })
    actorId!: Types.ObjectId;

    @Prop({ required: true })
    action!: string; // e.g. 'ROLE_PERMISSION_CHANGED', 'USER_DELETED', 'TICKET_REASSIGNED'

    @Prop({ required: true })
    entityType!: string; // e.g. 'User', 'Role', 'Ticket'

    // Kept as a plain string, not a typed ref — entityType varies per entry, and the
    // referenced collections use different ID formats (some ObjectId, some custom strings).
    @Prop({ required: true })
    entityId!: string;

    @Prop({ type: Object })
    before?: Record<string, any>; // absent for CREATE actions — nothing existed before

    @Prop({ type: Object })
    after?: Record<string, any>; // absent for DELETE actions — nothing exists after

    @Prop()
    ip?: string;

    @Prop({ required: true })
    timestamp!: Date;

    // The chain: this entry's hash covers its own content AND the previous entry's hash.
    // Altering any past entry changes its hash, which no longer matches what the NEXT
    // entry's prevHash recorded — that mismatch is exactly what makes tampering detectable.
    @Prop({ required: true })
    hash!: string;

    @Prop({ required: true })
    prevHash!: string; // 'GENESIS' for the very first entry in the collection
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ actorId: 1, timestamp: -1 });
AuditLogSchema.index({ entityType: 1, entityId: 1 });
AuditLogSchema.index({ timestamp: -1 });
