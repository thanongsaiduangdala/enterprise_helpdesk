import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type SupplyRequestDocument = SupplyRequest & Omit<Document, '_id'>;

export enum SupplyRequestStatus {
    REQUESTED = 'REQUESTED',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED',
    FULFILLED = 'FULFILLED',
}

@Schema({ _id: false })
class SupplyRequestItem {
    // Omitted for free-text "other" items that aren't in the catalog.
    @Prop({ type: String, ref: 'SupplyCatalogItem' })
    catalogItemId?: string;

    @Prop({ required: true })
    name!: string;

    @Prop({ required: true, min: 1 })
    quantity!: number;

    @Prop()
    reason?: string;
}

@Schema({ timestamps: true })
export class SupplyRequest {
    @Prop({ type: String })
    _id!: string; // e.g. 'SR001'

    @Prop({ type: Types.ObjectId, ref: 'User', required: true })
    requestedBy!: Types.ObjectId;

    @Prop({ type: [SupplyRequestItem], required: true })
    items!: SupplyRequestItem[];

    @Prop({ enum: SupplyRequestStatus, default: SupplyRequestStatus.REQUESTED })
    status!: SupplyRequestStatus;

    @Prop({ type: Types.ObjectId, ref: 'User' })
    approvedBy?: Types.ObjectId;

    @Prop()
    approvedAt?: Date;

    @Prop()
    rejectionReason?: string;

    @Prop({ type: Types.ObjectId, ref: 'User' })
    fulfilledBy?: Types.ObjectId;

    @Prop()
    fulfilledAt?: Date;
}

export const SupplyRequestSchema = SchemaFactory.createForClass(SupplyRequest);
SupplyRequestSchema.index({ requestedBy: 1, status: 1 });
SupplyRequestSchema.index({ status: 1 });
