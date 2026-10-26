import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type GoodsReceiptDocument = GoodsReceipt & Document;

export enum GoodsReceiptMode {
  /** ເພີ່ມເຄື່ອງເຂົ້າສະຕັອກ — ລາຍການມີໃນ catalog ແລ້ວ */
  RESTOCK = 'RESTOCK',
  /** ຊື້ເຄື່ອງໃໝ່ — ສ້າງລາຍການໃນ catalog ແລະ ຮັບເຂົ້າໃນຂັ້ນຕອນດຽວ */
  NEW_ITEM = 'NEW_ITEM',
}

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class GoodsReceipt {
  /** ເລກທີໃບຮັບເຄື່ອງ (GR-0001) — ອອກອັດຕະໂນມັດ */
  @Prop({ unique: true, sparse: true })
  receiptNo?: string;

  @Prop({ required: true, enum: GoodsReceiptMode })
  mode!: GoodsReceiptMode;

  @Prop({ type: String, ref: 'SupplyCatalogItem', required: true })
  catalogItemId!: string;

  /** ສຳເນົາຊື່/ໜ່ວຍ ໄວ້ສະແດງໃນປະຫວັດ ເຖິງແມ່ນລາຍການຖືກປ່ຽນຊື່ພາຍຫຼັງ */
  @Prop({ required: true })
  itemName!: string;

  @Prop()
  unit?: string;

  /** ຈຳນວນຊິ້ນ (ບໍ່ແມ່ນເງິນ) */
  @Prop({ required: true, min: 1 })
  quantity!: number;

  /** ຈຳນວນຕາມໃບສົ່ງເຄື່ອງ (ຖ້າມີ) */
  @Prop({ min: 1 })
  expectedQuantity?: number;

  /** ໝາຍເຫດເມື່ອຈຳນວນນັບບໍ່ກົງກັບໃບສົ່ງ */
  @Prop()
  countNote?: string;

  @Prop()
  stockBefore?: number;

  @Prop()
  stockAfter?: number;

  /** ສາຂາ / ບ່ອນເກັບ */
  @Prop({ type: String, ref: 'Branch' })
  branchId?: string;

  @Prop({ required: true })
  receivedDate!: Date;

  @Prop()
  vendor?: string;

  /** ລາຄາຕໍ່ໜ່ວຍ ແລະ ລາຄາລວມ (ກີບ) — ລາຄາລວມ = ລາຄາຕໍ່ໜ່ວຍ × ຈຳນວນ (ຄຳນວນໃນ backend) */
  @Prop({ min: 0 })
  unitPrice?: number;

  @Prop({ min: 0 })
  totalPrice?: number;

  /** ຫ້ອງ / ບ່ອນເກັບເຄື່ອງ */
  @Prop()
  storageRoom?: string;

  /** ໃບບິນຈາກຮ້ານ: ເລກທີ + ໄຟລ໌ແນບ (/api/uploads/...) */
  @Prop()
  invoiceNo?: string;

  @Prop()
  invoiceFileUrl?: string;

  @Prop()
  invoiceFileName?: string;

  /** ໃບສະເໜີຊື້ທີ່ຜູກກັບການຮັບເຄື່ອງນີ້ */
  @Prop()
  purchaseRequestId?: string;

  @Prop()
  purchaseRequestNo?: string;

  /** ຮັບເຄື່ອງໂດຍບໍ່ມີໃບສະເໜີ (ຂໍ້ຍົກເວັ້ນ) — ຕ້ອງມີເຫດຜົນ */
  @Prop()
  exceptionReason?: string;

  @Prop()
  note?: string;

  @Prop({ type: [String], default: [] })
  serialNumbers!: string[];

  @Prop({ type: [String], default: [] })
  assetIds!: string[];

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  createdAt?: Date;
}

export const GoodsReceiptSchema = SchemaFactory.createForClass(GoodsReceipt);
GoodsReceiptSchema.index({ createdAt: -1 });
GoodsReceiptSchema.index({ catalogItemId: 1 });
