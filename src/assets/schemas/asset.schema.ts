import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AssetDocument = Asset & Omit<Document, '_id'>;

export enum AssetStatus {
  AVAILABLE = 'AVAILABLE',
  ASSIGNED = 'ASSIGNED',
  UNDER_REPAIR = 'UNDER_REPAIR',
  RETIRED = 'RETIRED',
}

export enum HolderType {
  /** ມອບໃຫ້ພະນັກງານຄົນໜຶ່ງ (ແບບເດີມ) */
  PERSON = 'PERSON',
  /** ເປັນຂອງພະແນກ — ມີຜູ້ຮັບຜິດຊອບ (custodian) ໜຶ່ງຄົນກຳກັບ */
  DEPARTMENT = 'DEPARTMENT',
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

  /** ມີຄ່າ = ມອບໃຫ້ພະແນກ (assigneeId = ຜູ້ຮັບຜິດຊອບ) */
  @Prop({ type: String, ref: 'Department' })
  departmentId?: string;

  /** ຜູ້ມາຮັບເຄື່ອງຈິງ ໃນກໍລະນີຮັບແທນຜູ້ຮັບຜິດຊອບ */
  @Prop({ type: Types.ObjectId, ref: 'User' })
  receivedById?: Types.ObjectId;
}

@Schema({ timestamps: true })
export class Asset {
  @Prop({ type: String })
  _id!: string;

  @Prop({ required: true, unique: true })
  assetTag!: string;

  @Prop({ type: String, ref: 'SupplyCatalogItem' })
  catalogItemId?: string;

  @Prop({ required: true })
  type!: string;

  /** Serial Number ຂອງເຄື່ອງ (ບໍ່ບັງຄັບ; ຖ້າມີຕ້ອງບໍ່ຊ້ຳກັບຊັບສິນອື່ນ) */
  @Prop()
  serialNumber?: string;

  @Prop({ enum: AssetStatus, default: AssetStatus.AVAILABLE })
  status!: AssetStatus;

  /** ຜູ້ຖືປັດຈຸບັນ: ຄົນ ຫຼື ພະແນກ. ເມື່ອເປັນພະແນກ currentAssigneeId = ຜູ້ຮັບຜິດຊອບ */
  @Prop({ enum: HolderType, default: HolderType.PERSON })
  holderType!: HolderType;

  @Prop({ type: String, ref: 'Department' })
  departmentId?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  currentAssigneeId?: Types.ObjectId;

  @Prop({ type: String, ref: 'Branch', required: true })
  branchId!: string;

  @Prop()
  purchaseDate?: Date;

  /** ລາຄາຊື້ຕໍ່ໜ່ວຍ (ກີບ) */
  @Prop({ min: 0 })
  purchasePrice?: number;

  @Prop()
  warrantyExpiry?: Date;

  @Prop({ type: [AssignmentHistoryEntry], default: [] })
  assignmentHistory!: AssignmentHistoryEntry[];
}

export const AssetSchema = SchemaFactory.createForClass(Asset);
AssetSchema.index({ branchId: 1, status: 1 });
AssetSchema.index({ currentAssigneeId: 1 });
AssetSchema.index({ departmentId: 1 });
// S/N ຕ້ອງບໍ່ຊ້ຳ — ຂ້າມຄ່າຫວ່າງ/ບໍ່ມີ (ໃຊ້ $gt '' ແທນ sparse ເພາະ sparse ບໍ່ຂ້າມ '')
AssetSchema.index(
  { serialNumber: 1 },
  { unique: true, partialFilterExpression: { serialNumber: { $gt: '' } } },
);