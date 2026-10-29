import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SupplyCatalogItemDocument = SupplyCatalogItem &
  Omit<Document, '_id'>;

export enum CatalogItemType {
  /** ຊັບສິນ — ສະຕ໊ອກນັບຈາກຈຳນວນຊັບສິນ AVAILABLE */
  ASSET = 'ASSET',
  /** ວັດສະດຸສິ້ນເປືອງ — ສະຕ໊ອກປັບດ້ວຍຕົວເລກ */
  CONSUMABLE = 'CONSUMABLE',
}

@Schema({ timestamps: true })
export class SupplyCatalogItem {
  @Prop({ type: String })
  _id!: string;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: true })
  category!: string;

  @Prop({ required: true })
  unit!: string;

  @Prop({ enum: CatalogItemType })
  itemType?: CatalogItemType;

  /** ສຳລັບ ASSET: true = ຕ້ອງມີ Serial Number, false = ຕິດ Asset Tag ຢ່າງດຽວ (ບໍ່ມີ S/N) */
  @Prop({ default: true })
  trackSerial!: boolean;

  @Prop({ required: true, default: 0, min: 0 })
  stockQty!: number;

  @Prop({ required: true, default: 5, min: 0 })
  lowStockThreshold!: number;

  @Prop({ default: true })
  isActive!: boolean;

  /** ຮູບຂອງລາຍການ (URL ຈາກ /api/uploads) — ທາງເລືອກ */
  @Prop()
  imageUrl?: string;
}

export const SupplyCatalogItemSchema =
  SchemaFactory.createForClass(SupplyCatalogItem);
SupplyCatalogItemSchema.index({ name: 1 }, { unique: true });
SupplyCatalogItemSchema.index({ category: 1 });
