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
  CONSUMABLE = 'CONSUMABLE',
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

  /** ວັນທີ່ຄາດວ່າຈະສົ່ງມອບ (expected delivery date) — ໜຶ່ງໃນ 5 ຟິວຂອງ PO */
  @Prop()
  expectedDeliveryDate?: Date;

  @Prop({ min: 1 })
  quantity?: number;

  /** ໃຊ້ສ້າງລາຍການ catalog ອັດຕະໂນມັດຕອນປິດ POPR (ຖ້າຍັງບໍ່ມີໃນຄາຕາລັອກ) */
  @Prop()
  category?: string;

  @Prop()
  unit?: string;

  @Prop({ min: 0 })
  lowStockThreshold?: number;

  @Prop()
  spec?: string;

  /** ງົບປະມານທັງ PO (ກີບ) */
  @Prop({ min: 0 })
  budget?: number;

  /** ຈຳນວນສັ່ງທັງໝົດຕາມ PO (ທຸກງວດ). ບໍ່ໃສ່ = ໃຊ້ quantity (PO ງວດດຽວ) */
  @Prop({ min: 1 })
  poTotalQuantity?: number;

  /** ງວດທີ (1, 2, …) ຂອງ PO ນີ້ */
  @Prop({ min: 1 })
  lotNo?: number;

  /** ລາຄາຊື້ ຕໍ່ 1 ໜ່ວຍ (ກີບ) — ຍອດລວມງວດ = price × quantity */
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

  /** ຜູ້ສັ່ງຊື້ (ບໍ່ໃສ່ = ຜູ້ບັນທຶກ POPR) */
  @Prop()
  orderedBy?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  orderedByUserId?: Types.ObjectId;

  /** PENDING (ຫາກໍ່ສັ່ງຊື້) → PROCESS (ກຳລັງດຳເນີນການ) */
  @Prop({ enum: PoprOrderStatus, default: PoprOrderStatus.PENDING })
  orderStatus!: PoprOrderStatus;
}

/**
 * ຕໍ່ໜ່ວຍທີ່ຮັບເຂົ້າ (ສຳລັບ ELECTRONIC/GENERAL): ແຕ່ລະໜ່ວຍມີ S/N ຂອງຕົນເອງ
 * ແລະ/ຫຼື ຜູກກັບຊັບສິນທີ່ລົງທະບຽນໄວ້ແລ້ວ (assetId). ຖ້າຜູກ → ບໍ່ສ້າງຊັບສິນໃໝ່ຊ້ຳ.
 * ຫຼັງປິດ POPR assetId ຈະຖືກຕື່ມໃຫ້ທຸກໜ່ວຍ (ທັງທີ່ຜູກ ແລະ ທີ່ລະບົບສ້າງ).
 */
@Schema({ _id: false })
export class ReceivingUnit {
  @Prop()
  serialNumber?: string;

  @Prop({ type: String, ref: 'Asset' })
  assetId?: string;
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

  /** ເກົ່າ (ໜ່ວຍດຽວ) — ຂໍ້ມູນໃໝ່ໃຊ້ units; ຍັງອ່ານໄດ້ເພື່ອ backward compatibility */
  @Prop()
  serialNumber?: string;

  /** ລາຍໜ່ວຍ: S/N ຕໍ່ໜ່ວຍ ຫຼື ຜູກຊັບສິນເດີມ */
  @Prop({ type: [ReceivingUnit], default: [] })
  units!: ReceivingUnit[];

  @Prop({ default: false })
  snMatch!: boolean;

  /** ຈຳນວນທີ່ຮັບເຂົ້າຈິງ — ໃຊ້ກັບວັດສະດຸສິ້ນເປືອງ (CONSUMABLE). ຖ້າບໍ່ໃສ່ ໃຊ້ procurement.quantity */
  @Prop({ min: 0 })
  receivedQuantity?: number;

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

  /** true = ເຂົ້າຄັງ (ຊັບສິນ AVAILABLE, ບວກສະຕ໊ອກ, ບໍ່ຕ້ອງມີຜູ້ຮັບ); false = ມອບໃຫ້ຜູ້ໃຊ້ທັນທີ */
  @Prop({ default: false })
  storeInStock!: boolean;

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

  /**
   * ໃບຂໍຊື້ (SupplyRequest) ຕົ້ນທາງ — ໜຶ່ງ PoprRecord ຕໍ່ໜຶ່ງລາຍການ (item line) ຂອງ SR.
   * ບໍ່ມີຄ່າ = ບັນທຶກເກົ່າ (legacy) — ຈັດການແບບ read-only.
   */
  @Prop({ type: String, ref: 'SupplyRequest' })
  supplyRequestId?: string;

  /** ດັດຊະນີລາຍການໃນ SR ທີ່ POPR ນີ້ຮັບຜິດຊອບ (item line identifier) */
  @Prop({ min: 0 })
  supplyRequestItemIndex?: number;

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

  /** ຊັບສິນທີ່ລະບົບສ້າງຕອນປິດ POPR — ເກັບໄວ້ເພື່ອຍ້ອນກັບເມື່ອເປີດໃໝ່ */
  @Prop({ type: [String], default: [] })
  appliedAssetIds!: string[];

  /** ຊັບສິນເດີມທີ່ POPR ຜູກ ແລະ ມອບໃຫ້ຜູ້ຮັບຕອນປິດ (ບໍ່ລຶບ ເມື່ອເປີດໃໝ່ — ແຕ່ຄືນເປັນ "ວ່າງ") */
  @Prop({ type: [String], default: [] })
  appliedLinkedAssetIds!: string[];

  /** ຈຳນວນສະຕ໊ອກທີ່ບວກເຂົ້າ catalog ຕອນປິດ POPR — ເກັບໄວ້ເພື່ອຍ້ອນກັບ */
  @Prop({ default: 0 })
  appliedStockDelta!: number;

  @Prop()
  reopenedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  reopenedBy?: Types.ObjectId;

  @Prop()
  reopenReason?: string;

  /** ປິດ PO ແບບບໍ່ຄົບ (ຕົກລົງຍົກເລີກສ່ວນທີ່ເຫຼືອ) — ບັນທຶກທີ່ງວດທີ່ກົດປິດ */
  @Prop({ default: false })
  poClosedShort!: boolean;

  @Prop()
  poClosedReason?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  poClosedBy?: Types.ObjectId;

  @Prop()
  poClosedAt?: Date;
}

export const PoprRecordSchema = SchemaFactory.createForClass(PoprRecord);
PoprRecordSchema.index({ status: 1 });
PoprRecordSchema.index({ createdBy: 1 });
PoprRecordSchema.index({ supplyRequestId: 1 });
PoprRecordSchema.index({ 'procurement.catalogItemId': 1 });
// ໃຊ້ partialFilterExpression ($gt: '') ແທນ sparse — sparse ບໍ່ຂ້າມຄ່າ '' ຈຶ່ງເຮັດໃຫ້ຮ່າງທີສອງທີ່ບໍ່ມີ PO ຊົນ (E11000)
// ໝາຍເຫດ: index ເກົ່າຊື່ເດີມຖືກປ່ຽນ options → PoprService.onModuleInit ຈະ drop ແລ້ວສ້າງໃໝ່ໃຫ້ອັດຕະໂນມັດ
// PO ໃຊ້ຊ້ຳໄດ້ (ຫຼາຍງວດຮັບຂອງ PO ດຽວກັນ) — ຄວາມສອດຄ່ອງກວດທີ່ service; index ນີ້ບໍ່ unique
PoprRecordSchema.index({ 'procurement.poNumber': 1 });
PoprRecordSchema.index(
  { 'receiving.serialNumber': 1 },
  {
    unique: true,
    partialFilterExpression: { 'receiving.serialNumber': { $gt: '' } },
  },
);
// S/N ຕໍ່ໜ່ວຍ — ບໍ່ໃຫ້ຊ້ຳລະຫວ່າງ POPR (ຊ້ຳໃນ POPR ດຽວກັນ ກວດທີ່ service)
PoprRecordSchema.index(
  { 'receiving.units.serialNumber': 1 },
  {
    unique: true,
    partialFilterExpression: { 'receiving.units.serialNumber': { $gt: '' } },
  },
);
PoprRecordSchema.index({ 'receiving.assetId': 1 });
PoprRecordSchema.index({ 'receiving.units.assetId': 1 });
