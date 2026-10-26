import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PurchaseRequestDocument = PurchaseRequest & Document;

export enum PurchaseRequestMode {
  /** ລາຍການມີໃນ Catalog ແລ້ວ */
  RESTOCK = 'RESTOCK',
  /** ລາຍການໃໝ່ — ຍັງບໍ່ມີໃນ Catalog (ຈະຖືກສ້າງຕອນຮັບເຄື່ອງຄັ້ງທຳອິດ) */
  NEW_ITEM = 'NEW_ITEM',
}

export enum PurchaseRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  PARTIALLY_RECEIVED = 'PARTIALLY_RECEIVED',
  RECEIVED = 'RECEIVED',
}

@Schema({ timestamps: true })
export class PurchaseRequest {
  /** ເລກທີໃບສະເໜີ PR-0001 */
  @Prop({ required: true, unique: true })
  prNo!: string;

  @Prop({ required: true, enum: PurchaseRequestMode })
  mode!: PurchaseRequestMode;

  /** RESTOCK: ມີຕັ້ງແຕ່ຕອນສະເໜີ. NEW_ITEM: ຖືກຕື່ມຫຼັງຮັບເຄື່ອງຄັ້ງທຳອິດ */
  @Prop({ type: String, ref: 'SupplyCatalogItem' })
  catalogItemId?: string;

  /** NEW_ITEM: ຂໍ້ມູນລາຍການທີ່ຈະສ້າງໃນ Catalog */
  @Prop({ type: Object })
  newItem?: { name: string; category: string; unit: string; type: string };

  @Prop({ required: true })
  itemName!: string;

  @Prop()
  unit?: string;

  @Prop({ required: true, min: 1 })
  quantity!: number;

  @Prop({ min: 0 })
  estimatedUnitPrice?: number;

  @Prop({ min: 0 })
  estimatedTotal?: number;

  @Prop()
  vendor?: string;

  @Prop({ required: true })
  reason!: string;

  @Prop()
  neededBy?: Date;

  @Prop({
    required: true,
    enum: PurchaseRequestStatus,
    default: PurchaseRequestStatus.PENDING,
  })
  status!: PurchaseRequestStatus;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  requestedBy!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  approvedBy?: Types.ObjectId;

  @Prop()
  approvedAt?: Date;

  @Prop()
  rejectReason?: string;

  /** ຈຳນວນທີ່ຮັບແລ້ວສະສົມ ຈາກໃບຮັບເຄື່ອງທີ່ຜູກກັບໃບນີ້ */
  @Prop({ default: 0, min: 0 })
  receivedQuantity!: number;

  /** ເລກທີໃບຮັບເຄື່ອງ (_id ຂອງ GoodsReceipt) ທີ່ຜູກກັບໃບນີ້ */
  @Prop({ type: [String], default: [] })
  receiptIds!: string[];

  createdAt?: Date;
  updatedAt?: Date;
}

export const PurchaseRequestSchema =
  SchemaFactory.createForClass(PurchaseRequest);
PurchaseRequestSchema.index({ status: 1, createdAt: -1 });
PurchaseRequestSchema.index({ requestedBy: 1, createdAt: -1 });
