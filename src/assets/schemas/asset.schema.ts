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
    returnedAt?: Date;

    @Prop()
    note?: string;
}

@Schema({ timestamps: true })
export class Asset {
    @Prop({ type: String })
    _id!: string;

    @Prop({ required: true, unique: true })
    assetTag!: string;

    @Prop({ required: true })
    type!: string;

    @Prop({ enum: AssetStatus, default: AssetStatus.AVAILABLE })
    status!: AssetStatus;


    @Prop({ type: Types.ObjectId, ref: 'User' })
    currentAssigneeId?: Types.ObjectId;

    @Prop({ type: String, ref: 'Branch', required: true })
    branchId!: string;

    @Prop()
    purchaseDate?: Date;

    @Prop()
    warrantyExpiry?: Date;



    @Prop({ type: [AssignmentHistoryEntry], default: [] })
    assignmentHistory!: AssignmentHistoryEntry[];
}

export const AssetSchema = SchemaFactory.createForClass(Asset);
AssetSchema.index({ branchId: 1, status: 1 });
AssetSchema.index({ currentAssigneeId: 1 });
