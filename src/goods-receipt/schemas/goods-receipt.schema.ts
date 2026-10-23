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

  @Prop({ required: true })
  receivedDate!: Date;

  @Prop()
  vendor?: string;

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
