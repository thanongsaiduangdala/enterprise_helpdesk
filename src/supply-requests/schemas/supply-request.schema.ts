import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type SupplyRequestDocument = SupplyRequest & Omit<Document, '_id'>;

export enum SupplyRequestSource {
  /** ພະນັກງານຂໍໃນນາມສ່ວນຕົວ — ຜ່ານຫົວໜ້າພະແນກກ່ອນ */
  PERSONAL = 'PERSONAL',
  /** ຂໍໃນນາມພະແນກ — ເຂົ້າຄິວຝ່າຍສາງໂດຍກົງ */
  DEPARTMENT = 'DEPARTMENT',
}

export enum SupplyRequestStatus {
  /** ຄຳຂໍສ່ວນບຸກຄົນ ລໍຖ້າຫົວໜ້າພະແນກຂອງຜູ້ຂໍອະນຸມັດ (ຂັ້ນທີ 1) ກ່ອນເຂົ້າຄິວຝ່າຍສາງ */
  PENDING_MANAGER = 'PENDING_MANAGER',
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

  /**
   * ໃບສະເໜີຊື້ (PurchaseRequest._id) ທີ່ຊື້ສ່ວນທີ່ສະຕັອກບໍ່ພໍ ຂອງລາຍການນີ້.
   * ຕັ້ງໂດຍ backend ຕອນສ້າງຄຳຂໍ (ບໍ່ຮັບຄ່າຈາກ client ໂດຍກົງນອກຈາກ id).
   */
  @Prop({ type: String })
  purchaseRequestId?: string;

  @Prop()
  purchaseRequestNo?: string;

  /** ຈຳນວນທີ່ຂໍຊື້ (ສ່ວນທີ່ຂາດ). ສ່ວນທີ່ເຫຼືອ (quantity - purchaseQty) ມາຈາກສະຕັອກເດີມ */
  @Prop({ min: 1 })
  purchaseQty?: number;

  /** ຈຳນວນ (ໃນ purchaseQty) ທີ່ຂອງມາຮອດຄັງແລ້ວ ຜ່ານໃບຮັບເຄື່ອງ */
  @Prop({ min: 0, default: 0 })
  arrivedQty?: number;
}

/** ບັນທຶກເມື່ອເຈົ້າໜ້າທີ່ສາງຮັບເຄື່ອງແທນ ໂດຍບໍ່ແມ່ນຜູ້ຂໍ/ຜູ້ຮັບແທນທີ່ກຳນົດໄວ້ (override) */
@Schema({ _id: false })
class SupplyRequestReceiveOverride {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  by!: Types.ObjectId;

  @Prop({ required: true })
  reason!: string;

  @Prop({ required: true })
  at!: Date;
}

@Schema({ timestamps: true })
export class SupplyRequest {
  @Prop({ type: String })
  _id!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  requestedBy!: Types.ObjectId;

  /** ມີຄ່າ = ໃບຂໍໃນນາມພະແນກ (ຊັບສິນຈະຂຶ້ນກັບພະແນກ) */
  @Prop({ type: String, ref: 'Department' })
  departmentId?: string;

  /** ຜູ້ຮັບຜິດຊອບ (custodian) ເມື່ອເປັນໃບຂໍຂອງພະແນກ */
  @Prop({ type: Types.ObjectId, ref: 'User' })
  custodianId?: Types.ObjectId;

  @Prop({ type: [SupplyRequestItem], required: true })
  items!: SupplyRequestItem[];

  @Prop({ enum: SupplyRequestStatus, default: SupplyRequestStatus.REQUESTED })
  status!: SupplyRequestStatus;

  /** ແຫຼ່ງທີ່ມາ: PERSONAL | DEPARTMENT (ໃບເກົ່າບໍ່ມີຄ່ານີ້ — ໃຫ້ເບິ່ງຈາກ departmentId) */
  @Prop({ enum: SupplyRequestSource })
  source?: SupplyRequestSource;

  /** ພະແນກຂອງຜູ້ຂໍ ຕອນຍື່ນ — ໃຊ້ກຳນົດຫົວໜ້າທີ່ຕ້ອງອະນຸມັດຂັ້ນທີ 1 (ຕັ້ງສະເພາະໃບທີ່ຜ່ານຂັ້ນນີ້) */
  @Prop({ type: String, ref: 'Department' })
  managerDepartmentId?: string;

  /** ເຫດຜົນທີ່ຂ້າມຂັ້ນຫົວໜ້າ: NO_DEPARTMENT | NO_MANAGER | REQUESTER_IS_MANAGER | DISABLED */
  @Prop()
  managerStageSkipped?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  managerApprovedBy?: Types.ObjectId;

  @Prop()
  managerApprovedAt?: Date;

  /** true = ຜູ້ມີສິດ supplies:approve ອະນຸມັດຂັ້ນຫົວໜ້າແທນ (ຫົວໜ້າລາພັກ ຯລຯ) */
  @Prop()
  managerApprovedAsSubstitute?: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  managerRejectedBy?: Types.ObjectId;

  @Prop()
  managerRejectedAt?: Date;

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

  /**
   * ຜູ້ຮັບແທນ (delegate) — ຄົນດຽວ. ຜູ້ຂໍ (ຫຼືຜູ້ຮັບຜິດຊອບ/ຫົວໜ້າແຜນກ) ກຳນົດ ຫຼືປ່ຽນໄດ້ຕະຫຼອດ
   * ຕັ້ງແຕ່ສ້າງໃບຂໍຈົນຮັບເຄື່ອງ. ຊັບສິນຍັງບັນທຶກໃຫ້ຜູ້ຂໍ/ແຜນກຄືເກົ່າ.
   */
  @Prop({ type: Types.ObjectId, ref: 'User' })
  delegateId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  delegateSetBy?: Types.ObjectId;

  @Prop()
  delegateSetAt?: Date;

  /** ມີຄ່າ = ເຈົ້າໜ້າທີ່ສາງໃຊ້ override ຮັບເຄື່ອງແທນ (ມີເຫດຜົນ ແລະ audit log) */
  @Prop({ type: SupplyRequestReceiveOverride })
  receiveOverride?: SupplyRequestReceiveOverride;

  /** ມີຄ່າ = ຂອງທີ່ຕ້ອງຊື້ມາຄົບແລ້ວ ແລະຈອງໄວ້ — ພ້ອມໃຫ້ຜູ້ຂໍ/ຜູ້ຮັບແທນມາສະແກນຮັບ */
  @Prop()
  readyToCollectAt?: Date;

  /** ຊັບສິນ (_id) ທີ່ຮັບໄປແລ້ວຕາມໃບນີ້ — ໃຊ້ນັບໂຄຕ້າ ບໍ່ໃຫ້ claim/ຮັບເກີນຈຳນວນທີ່ຂໍ */
  @Prop({ type: [String], default: [] })
  receivedAssetIds!: string[];
}

export const SupplyRequestSchema = SchemaFactory.createForClass(SupplyRequest);
SupplyRequestSchema.index({ requestedBy: 1, status: 1 });
SupplyRequestSchema.index({ departmentId: 1, status: 1 });
SupplyRequestSchema.index({ status: 1 });
SupplyRequestSchema.index({ managerDepartmentId: 1, status: 1 });
SupplyRequestSchema.index({ delegateId: 1, status: 1 });
