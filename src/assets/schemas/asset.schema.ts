import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AssetDocument = Asset & Omit<Document, '_id'>;

export enum AssetStatus {
    AVAILABLE = 'AVAILABLE',
    ASSIGNED = 'ASSIGNED',
    UNDER_REPAIR = 'UNDER_REPAIR',
    RETIRED = 'RETIRED',
}

@Schema({ _id: false })
class AssignmentHistoryEntry {
    @Prop({ type: Types.ObjectId, ref: 'User', required: true })
    assigneeId!: Types.ObjectId;

    @Prop({ required: true })
    assignedAt!: Date;

    @Prop()
    returnedAt?: Date; // absent while the assignment is still active

    @Prop()
    note?: string;
}

@Schema({ timestamps: true })
export class Asset {
    @Prop({ type: String })
    _id!: string; // e.g. 'AS001' — see AssetsService.generateId() for the gap-filling logic

    @Prop({ required: true, unique: true })
    assetTag!: string; // the physical inventory label, e.g. 'A-1042'

    @Prop({ required: true })
    type!: string; // e.g. 'Laptop', 'Monitor', 'ID Card', 'Phone'

    @Prop({ enum: AssetStatus, default: AssetStatus.AVAILABLE })
    status!: AssetStatus;

    // Only set while status is ASSIGNED. Cleared on return.
    @Prop({ type: Types.ObjectId, ref: 'User' })
    currentAssigneeId?: Types.ObjectId;

    @Prop({ type: String, ref: 'Branch', required: true })
    branchId!: string;

    @Prop()
    purchaseDate?: Date;

    @Prop()
    warrantyExpiry?: Date;

    // Full audit trail of every assignment, newest last. The most recent entry
    // with no returnedAt (if any) is the current assignment.
    @Prop({ type: [AssignmentHistoryEntry], default: [] })
    assignmentHistory!: AssignmentHistoryEntry[];
}

export const AssetSchema = SchemaFactory.createForClass(Asset);
AssetSchema.index({ branchId: 1, status: 1 });
AssetSchema.index({ currentAssigneeId: 1 });
