import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type SupplyRequestDocument = SupplyRequest & Omit<Document, '_id'>;

export enum SupplyRequestStatus {
  REQUESTED = 'REQUESTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  /** ອະນຸມັດແລ້ວ ແລະ ມີ PO/ສັ່ງຊື້ແລ້ວ ແຕ່ຍັງບໍ່ຮັບຂອງ */
  ORDERED = 'ORDERED',
  /** ຮັບຂອງແລ້ວບາງສ່ວນ (ບາງລາຍການ/ບາງງວດ) */
  PARTIALLY_RECEIVED = 'PARTIALLY_RECEIVED',
  /** ຮັບຄົບທຸກລາຍການແລ້ວ (ປິດ) */
  CLOSED = 'CLOSED',
  /**
   * @deprecated alias ຂອງ CLOSED — ຂໍ້ມູນທີ່ບັນທຶກໃນເວລາກ່ອນຢູ່ໃນ status ນີ້
   * ລະບົບປົດໃຫ້ຖືກເປັນ terminal (ບໍ່ເຄີນຖືກຄຳນວນກັບຄືນ)
   */
  FULFILLED = 'FULFILLED',
}

@Schema({ _id: false })
class SupplyRequestItem {
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
  _id!: string;

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

  @Prop({ type: Types.ObjectId, ref: 'User' })
  receivedBy?: Types.ObjectId;

  /** ຊັບສິນ (_id) ທີ່ຮັບໄປແລ້ວຕາມໃບນີ້ — ໃຊ້ນັບໂຄຕ້າ ບໍ່ໃຫ້ claim/ຮັບເກີນຈຳນວນທີ່ຂໍ */
  @Prop({ type: [String], default: [] })
  receivedAssetIds!: string[];
}

export const SupplyRequestSchema = SchemaFactory.createForClass(SupplyRequest);
SupplyRequestSchema.index({ requestedBy: 1, status: 1 });
SupplyRequestSchema.index({ status: 1 });
