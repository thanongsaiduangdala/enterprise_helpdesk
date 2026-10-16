import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PoprRecordDocument = PoprRecord & Omit<Document, '_id'>;

export enum PoprStatus {
  DRAFT = 'DRAFT',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
}

/** ປະເພດອຸປະກອນ — ELECTRONIC ຕ້ອງມີ S/N, OS, ຊອບແວຄວາມປອດໄພ; GENERAL ບໍ່ຈຳເປັນ */
export enum PoprItemType {
  ELECTRONIC = 'ELECTRONIC',
  GENERAL = 'GENERAL',
}

/** ສະພາບກ່ອງ/ອຸປະກອນ — ຄ່າກົງກັບ frontend (good / damaged / partial) */
export enum PoprCondition {
  GOOD = 'good',
  DAMAGED = 'damaged',
  PARTIAL = 'partial',
}

/** ສະຖານະຊັບສິນຫຼັງສົ່ງມອບ */
export enum PoprAssetStatus {
  IN_USE = 'IN_USE',
  IN_STOCK = 'IN_STOCK',
  MAINTENANCE = 'MAINTENANCE',
  RETIRED = 'RETIRED',
}

/** ສະຖານະການສັ່ງຊື້ ໃນໄລຍະ P (ຈັດຫາ/ຈັດຊື້) — PENDING → PROCESS */
export enum PoprOrderStatus {
  PENDING = 'PENDING',
  PROCESS = 'PROCESS',
}

/** ສະຖານະການສົ່ງ/ກວດຮັບ ໃນໄລຍະ O (ຮັບເຂົ້າ/ຕ້ອນຮັບ) — SHIPPING → REVIEW → RECEIVED */
export enum PoprDeliveryStatus {
  SHIPPING = 'SHIPPING',
  REVIEW = 'REVIEW',
  RECEIVED = 'RECEIVED',
}

/** P — ການຈັດຫາ/ຈັດຊື້ */
@Schema({ _id: false })
export class ProcurementDetails {
  @Prop({ type: String, ref: 'SupplyCatalogItem' })
  catalogItemId?: string;

  @Prop()
  itemName?: string;

  @Prop({ min: 1 })
  quantity?: number;

  @Prop()
  spec?: string;

  @Prop({ min: 0 })
  budget?: number;

  @Prop({ min: 0 })
  price?: number;

  @Prop()
  vendor?: string;

  @Prop({ default: false })
  vendorStandard!: boolean;

  @Prop({ default: false })
  warrantyAgreement!: boolean;

  @Prop()
  poNumber?: string;

  @Prop()
  goodsReceiptNo?: string;

  /** PENDING (ຫາກໍ່ສັ່ງຊື້) → PROCESS (ກຳລັງດຳເນີນການ) */
  @Prop({ enum: PoprOrderStatus, default: PoprOrderStatus.PENDING })
  orderStatus!: PoprOrderStatus;
}

/** O — ການຮັບເຂົ້າ/ຕ້ອນຮັບ ຢູ່ສະຖານທີ່ */
@Schema({ _id: false })
export class ReceivingDetails {
  @Prop()
  receivedDate?: Date;

  @Prop({ enum: PoprCondition, default: PoprCondition.GOOD })
  boxCondition?: PoprCondition;

  @Prop({ enum: PoprCondition, default: PoprCondition.GOOD })
  equipmentCondition?: PoprCondition;

  @Prop()
  serialNumber?: string;

  @Prop({ default: false })
  snMatch!: boolean;

  @Prop()
  assetTag?: string;

  @Prop({ type: String, ref: 'Asset' })
  assetId?: string;

  @Prop({ default: false })
  assetRegistered!: boolean;

  @Prop()
  receivedBy?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  receivedByUserId?: Types.ObjectId;

  @Prop()
  custodian?: string;

  @Prop()
  location?: string;

  /** SHIPPING (ກຳລັງສົ່ງ) → REVIEW (ກວດຮັບ) → RECEIVED (ຮັບຮຽບຮ້ອຍແລ້ວ) */
  @Prop({ enum: PoprDeliveryStatus, default: PoprDeliveryStatus.SHIPPING })
  deliveryStatus!: PoprDeliveryStatus;
}

/** P — ການຕຽມ/ກຳນົດຄ່າ */
@Schema({ _id: false })
export class PreparationDetails {
  @Prop()
  os?: string;

  @Prop()
  software?: string;

  @Prop({ default: false })
  secAntivirus!: boolean;

  @Prop({ default: false })
  secEdr!: boolean;

  @Prop({ default: false })
  secFirewall!: boolean;

  @Prop({ default: false })
  domainJoined!: boolean;

  @Prop()
  userAccount?: string;

  @Prop()
  network?: string;

  @Prop()
  accessRights?: string;

  @Prop({ default: false })
  diskEncryption!: boolean;

  @Prop({ default: false })
  securityPolicy!: boolean;
}

/** R — ການປ່ອຍ/ລົງທະບຽນ */
@Schema({ _id: false })
export class ReleaseDetails {
  @Prop()
  deliveredTo?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  deliveredToUserId?: Types.ObjectId;

  @Prop()
  assignedUser?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  assignedUserId?: Types.ObjectId;

  @Prop()
  deliveryDate?: Date;

  @Prop({ enum: PoprAssetStatus, default: PoprAssetStatus.IN_USE })
  assetStatus?: PoprAssetStatus;

  @Prop({ default: false })
  signedHandover!: boolean;

  @Prop({ default: false })
  userOrientation!: boolean;
}

@Schema({ timestamps: true })
export class PoprRecord {
  @Prop({ type: String })
  _id!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ enum: PoprStatus, default: PoprStatus.DRAFT })
  status!: PoprStatus;

  @Prop({ enum: PoprItemType, default: PoprItemType.ELECTRONIC })
  itemType!: PoprItemType;

  /** ໄລຍະທີ່ດຳເນີນການຮອດ (1 = P ຈັດຊື້ ... 4 = R ປ່ອຍ) */
  @Prop({ default: 1, min: 1, max: 4 })
  stage!: number;

  @Prop({ type: ProcurementDetails, default: {} })
  procurement!: ProcurementDetails;

  @Prop({ type: ReceivingDetails, default: {} })
  receiving!: ReceivingDetails;

  @Prop({ type: PreparationDetails, default: {} })
  preparation!: PreparationDetails;

  @Prop({ type: ReleaseDetails, default: {} })
  release!: ReleaseDetails;

  @Prop()
  completedAt?: Date;
}

export const PoprRecordSchema = SchemaFactory.createForClass(PoprRecord);
PoprRecordSchema.index({ status: 1 });
PoprRecordSchema.index({ createdBy: 1 });
PoprRecordSchema.index({ 'procurement.catalogItemId': 1 });
