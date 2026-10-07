import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type MaintenanceHistoryDocument = MaintenanceHistory & Document;

export enum MaintenanceStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

@Schema({ timestamps: true })
export class MaintenanceHistory {
  // Asset._id ເປັນ string ທີ່ສ້າງເອງ (ເຊັ່ນ AS001) ບໍ່ແມ່ນ ObjectId — ຕ້ອງເກັບເປັນ String ແບບດຽວກັນກັບ branchId
  @Prop({ type: String, ref: 'Asset', required: true })
  assetId!: string;

  @Prop()
  maintenanceDate?: Date;

  @Prop()
  completionDate?: Date;

  @Prop({ enum: MaintenanceStatus, default: MaintenanceStatus.IN_PROGRESS })
  status!: MaintenanceStatus;

  @Prop()
  previousStatus?: string;

  @Prop()
  newStatus?: string;

  @Prop()
  issue?: string;

  @Prop()
  description?: string;

  @Prop()
  repairNotes?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  technicianId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  recordedBy?: Types.ObjectId;

  @Prop()
  cost?: number;

  @Prop()
  invoiceNumber?: string;
}

export const MaintenanceHistorySchema =
  SchemaFactory.createForClass(MaintenanceHistory);
MaintenanceHistorySchema.index({ assetId: 1, maintenanceDate: -1 });
MaintenanceHistorySchema.index({ status: 1 });
