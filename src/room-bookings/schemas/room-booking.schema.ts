import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type RoomBookingDocument = RoomBooking & Omit<Document, '_id'>;

export enum BookingStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

@Schema({ _id: false })
class Recurrence {
  @Prop({ required: true, enum: ['daily', 'weekly'] })
  frequency!: string;

  @Prop({ required: true })
  until!: Date;
}

// ປະຫວັດການປ່ຽນແປງຂອງການຈອງ (timeline) — ເກັບແບບ append-only ໝົດທຸກເຫດການ:
// ສ້າງ, ຂໍເລື່ອນເວລາ (ເວລາເດີມ → ເວລາໃໝ່), ອະນຸມັດ/ປະຕິເສດ (ພ້ອມຜູ້ຕັດສິນ ແລະ ເຫດຜົນ), ຍົກເລີກ, check-in/out
// ເພື່ອໃນຄລິກລາຍການຈອງແລ້ວເຫັນ "ປະຫວັດວ່າເກີດຫຍັງຂຶ້ນແດ່" ໂດຍບໍ່ສູນເສຍຂໍ້ມູນເວລາເດີມ
@Schema({ _id: false })
export class RoomBookingHistoryEntry {
  @Prop({ required: true })
  action!: string; // CREATED | APPROVED | REJECTED | RESCHEDULE_REQUESTED | REQUEST_UPDATED | RESCHEDULE_APPROVED | RESCHEDULE_REJECTED | CHANGE_REQUESTED | CANCELLED | NO_SHOW | CHECKED_IN | CHECKED_OUT

  // ເວລາເດີມ (ກ່ອນປ່ຽນ) ສຳລັບເຫດການທີ່ກ່ຽວກັບເວລາ
  @Prop()
  fromStartAt?: Date;

  @Prop()
  fromEndAt?: Date;

  // ເວລາໃໝ່ (ຫຼັງປ່ຽນ/ທີ່ຂໍ) ສຳລັບເຫດການທີ່ກ່ຽວກັບເວລາ
  @Prop()
  toStartAt?: Date;

  @Prop()
  toEndAt?: Date;

  // ຜູ້ກະທຳ (ຜູ້ຂໍ/ຜູ້ອະນຸມັດ) — ອາດບໍ່ມີສຳລັບເຫດການອັດຕະໂນມັດ (no-show)
  @Prop({ type: Types.ObjectId, ref: 'User' })
  actorId?: Types.ObjectId;

  @Prop()
  note?: string;

  @Prop({ required: true, default: Date.now })
  at!: Date;
}

export enum InviteMode {
  PRIVATE = 'PRIVATE', // ມີແຕ່ຄົນໃນລາຍຊື່ເທົ່ານັ້ນທີ່ເຂົ້າໄດ້ — ຜູ້ຈອງເພີ່ມຄົນເທື່ອລະຄົນ
  PUBLIC = 'PUBLIC', // ໃຜສະແກນ QR ກໍເຂົ້າໄດ້
}

export type CheckInResult = 'ADMITTED' | 'DENIED';

// ແຂກທີ່ຖືກເຊີນແບບ PRIVATE — ແຕ່ລະຄົນມີ token ສ່ວນຕົວ (ໃຊ້ສ້າງ QR ສະເພາະຄົນ)
@Schema()
export class BookingInvitee {
  _id?: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  @Prop()
  email?: string;

  @Prop()
  phone?: string;

  @Prop()
  userId?: string;

  @Prop()
  employeeCode?: string;

  @Prop({ required: true })
  token!: string;

  @Prop({ default: Date.now })
  addedAt!: Date;

  // ຜູ້ຈອງລຶບອອກຈາກລາຍຊື່ — ເກັບໄວ້ (ບໍ່ລຶບແທ້) ເພື່ອໃຫ້ QR ເກົ່າຖືກປະຕິເສດ ແລະ ຍັງມີຫຼັກຖານໃນລາຍງານ
  @Prop()
  revokedAt?: Date;

  @Prop()
  joinedAt?: Date;
}
export const BookingInviteeSchema =
  SchemaFactory.createForClass(BookingInvitee);

// ບັນທຶກທຸກການສະແກນ QR ທີ່ເຂົ້າມາ (ຜ່ານ ແລະ ຖືກປະຕິເສດ) — ໃຊ້ອອກລາຍງານ CSV/PDF
@Schema({ _id: false })
export class BookingCheckIn {
  @Prop({ required: true })
  name!: string;

  @Prop()
  contact?: string;

  @Prop()
  inviteeId?: string;

  @Prop()
  userId?: string;

  @Prop()
  employeeCode?: string;

  @Prop({ required: true, enum: ['ADMITTED', 'DENIED'] })
  result!: CheckInResult;

  @Prop()
  reason?: string;

  @Prop({ required: true, enum: ['DOOR_QR', 'PERSONAL_QR'] })
  via!: string;

  @Prop({ required: true, default: Date.now })
  at!: Date;
}

@Schema({ timestamps: true })
export class RoomBooking {
  @Prop({ type: String })
  _id!: string;

  @Prop({ required: true })
  title!: string;

  @Prop({ type: String, ref: 'Room', required: true })
  roomId!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  bookedBy!: Types.ObjectId;

  @Prop({ required: true })
  startAt!: Date;

  @Prop({ required: true })
  endAt!: Date;

  @Prop({ type: Recurrence })
  recurrence?: Recurrence;

  @Prop()
  seriesId?: string;

  @Prop({ enum: BookingStatus, default: BookingStatus.PENDING })
  status!: BookingStatus;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  reviewedBy?: Types.ObjectId;

  @Prop()
  reviewedAt?: Date;

  @Prop()
  rejectionReason?: string;

  // ຄຳຮ້ອງເລື່ອນເວລາທີ່ລໍຖ້າການອະນຸມັດ — ເກັບໄວ້ແຍກຕ່າງຫາກ ເພື່ອບໍ່ໃຫ້ກະທົບເວລາເດີມທີ່
  // ອະນຸມັດແລ້ວ (startAt/endAt). ຖ້າອະນຸມັດ ຈະຍ້າຍໄປເວລາໃໝ່; ຖ້າປະຕິເສດ ຈະລຶບອອກ ແລະ ຄົງເວລາເດີມໄວ້
  @Prop()
  pendingStartAt?: Date;

  @Prop()
  pendingEndAt?: Date;

  @Prop()
  pendingRequestedAt?: Date;

  // ຫ້ອງໃໝ່ທີ່ຂໍຍ້າຍໄປ (ພ້ອມເວລາໃໝ່) — ຖ້າບໍ່ມີ ຄືຄົງຫ້ອງເດີມ
  @Prop({ type: String, ref: 'Room' })
  pendingRoomId?: string;

  // ເຫດຜົນທີ່ຜູ້ອະນຸມັດບໍ່ອະນຸມັດ "ຄຳຮ້ອງເລື່ອນເວລາ" — ເກັບແຍກຕ່າງຫາກຈາກ rejectionReason ເພື່ອບໍ່ໃຫ້ສັບສົນ
  // ກັບການປະຕິເສດການຈອງທັງໝົດ (booking ຍັງຄົງອະນຸມັດຢູ່ເວລາເດີມ ເມື່ອຖືກປະຕິເສດຄຳຮ້ອງເລື່ອນເວລາ)
  @Prop()
  rescheduleRejectionReason?: string;

  // ຄຳຂໍຈາກຜູ້ອະນຸມັດໃຫ້ຜູ້ຈອງ "ປ່ຽນເວລາ ຫຼື ປ່ຽນຫ້ອງ" ເພາະຕາຕະລາງຊົ່ວກັບການຈອງອື່ນ
  // (TIME | ROOM | EITHER). ຖືກລຶບອອກເມື່ອຜູ້ຈອງສົ່ງເວລາໃໝ່
  @Prop({ enum: ['TIME', 'ROOM', 'EITHER'] })
  changeRequestType?: string;

  @Prop()
  changeRequestMessage?: string;

  @Prop()
  changeRequestedAt?: Date;

  // ຫ້ອງທີ່ຜູ້ອະນຸມັດແນະນຳໃຫ້ຜູ້ຈອງຍ້າຍໄປ (ສະແດງ "ແນະນຳ" ໃນລາຍການຫ້ອງຂອງຜູ້ຈອງ)
  @Prop()
  changeSuggestedRoomId?: string;

  // ຄຳຕອບຂອງຜູ້ຈອງຕອນຈອງ: ຖ້າເວລາຊົ່ວກັບຄຳຮ້ອງອື່ນ ຍອມປ່ຽນຫຍັງໄດ້ (TIME | ROOM | BOTH)
  @Prop({ enum: ['TIME', 'ROOM', 'BOTH', 'NONE'], default: 'BOTH' })
  changeFlexibility?: string;

  // ເວລາທີ່ຜູ້ອະນຸມັດແນະນຳໃຫ້ຜູ້ຈອງຍ້າຍໄປ (ໄລຍະເວລາເທົ່າກັບທີ່ຜູ້ຈອງຂໍມາ)
  @Prop()
  changeSuggestedStartAt?: Date;

  @Prop()
  changeSuggestedEndAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  changeRequestedBy?: Types.ObjectId;

  // ການຈອງທີ່ຊົ່ວກັນ ຕອນຜູ້ອະນຸມັດສົ່ງຄຳຂໍ — ເກັບໄວ້ສະແດງໃນຕາຕະລາງຂອງຜູ້ຈອງ
  // (ຜູ້ຈອງບໍ່ເຫັນຄຳຮ້ອງ pending ຂອງຄົນອື່ນ ຈຶ່ງຕ້ອງເກັບເວລາໄວ້ນຳ)
  @Prop({
    type: [{ _id: false, title: String, startAt: Date, endAt: Date }],
    default: undefined,
  })
  changeConflicts?: { title?: string; startAt: Date; endAt: Date }[];

  // ບັນທຶກເວລາເຂົ້າ/ອອກຫ້ອງແທ້ໆ (ບໍ່ແມ່ນແຄ່ເວລາທີ່ຈອງໄວ້) — ໃຊ້ຢືນຢັນວ່າກຳລັງໃຊ້ຫ້ອງແທ້ໆ ແລະ ກວດ no-show
  @Prop()
  checkedInAt?: Date;

  @Prop()
  checkedOutAt?: Date;

  // ລາຍຊື່ຄົນເຂົ້າຮ່ວມປະຊຸມ (ຊື່ຄົນ, ບໍ່ຈຳກັດວ່າຕ້ອງເປັນຜູ້ໃຊ້ໃນລະບົບ — ອາດມີແຂກພາຍນອກ)
  @Prop({ type: [String], default: [] })
  attendees!: string[];

  // ===== ເຊີນຄົນເຂົ້າຫ້ອງດ້ວຍ QR =====
  // undefined = ຍັງບໍ່ເປີດການເຊີນ
  @Prop({ enum: InviteMode })
  inviteMode?: InviteMode;

  // token ຂອງ QR ກາງ (ປະຕູຫ້ອງ) — ໃຊ້ໃນໂໝດ PUBLIC (ໃຜກໍສະແກນໄດ້) ແລະ ໂໝດ PRIVATE (ຕ້ອງກວດຊື່ກັບລາຍຊື່)
  // select:false ກັນບໍ່ໃຫ້ token ຫຼຸດອອກໄປກັບ list API ອື່ນໆ (ຕາຕະລາງ/ການຈອງຂອງຂ້ອຍ/ລໍຖ້າອະນຸມັດ) — ຕ້ອງ select('+...') ຊັດເຈນ
  @Prop({ select: false })
  inviteToken?: string;

  @Prop({ type: [BookingInviteeSchema], default: [], select: false })
  invitees!: BookingInvitee[];

  @Prop({ type: [BookingCheckIn], default: [], select: false })
  checkIns!: BookingCheckIn[];

  // ປະຫວັດການປ່ຽນແປງທັງໝົດຂອງການຈອງນີ້ (ເບິ່ງໄດ້ໃນ popup ລາຍລະອຽດ)
  @Prop({ type: [RoomBookingHistoryEntry], default: [] })
  history!: RoomBookingHistoryEntry[];
}

export const RoomBookingSchema = SchemaFactory.createForClass(RoomBooking);

RoomBookingSchema.index({ roomId: 1, startAt: 1, endAt: 1 });
RoomBookingSchema.index({ bookedBy: 1, status: 1 });
RoomBookingSchema.index({ inviteToken: 1 }, { unique: true, sparse: true });
RoomBookingSchema.index({ 'invitees.token': 1 }, { sparse: true });
