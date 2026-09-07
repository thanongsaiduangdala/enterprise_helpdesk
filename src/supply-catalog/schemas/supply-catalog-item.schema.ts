import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SupplyCatalogItemDocument = SupplyCatalogItem & Omit<Document, '_id'>;

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

    @Prop({ required: true, default: 0, min: 0 })
    stockQty!: number;

    @Prop({ required: true, default: 5, min: 0 })
    lowStockThreshold!: number;

    @Prop({ default: true })
    isActive!: boolean;
}

export const SupplyCatalogItemSchema = SchemaFactory.createForClass(SupplyCatalogItem);
SupplyCatalogItemSchema.index({ name: 1 }, { unique: true });
SupplyCatalogItemSchema.index({ category: 1 });
