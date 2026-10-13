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
    action!: string; // CREATED | APPROVED | REJECTED | RESCHEDULE_REQUESTED | REQUEST_UPDATED | RESCHEDULE_APPROVED | RESCHEDULE_REJECTED | CANCELLED | NO_SHOW | CHECKED_IN | CHECKED_OUT

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

    // ເຫດຜົນທີ່ຜູ້ອະນຸມັດບໍ່ອະນຸມັດ "ຄຳຮ້ອງເລື່ອນເວລາ" — ເກັບແຍກຕ່າງຫາກຈາກ rejectionReason ເພື່ອບໍ່ໃຫ້ສັບສົນ
    // ກັບການປະຕິເສດການຈອງທັງໝົດ (booking ຍັງຄົງອະນຸມັດຢູ່ເວລາເດີມ ເມື່ອຖືກປະຕິເສດຄຳຮ້ອງເລື່ອນເວລາ)
    @Prop()
    rescheduleRejectionReason?: string;

    // ບັນທຶກເວລາເຂົ້າ/ອອກຫ້ອງແທ້ໆ (ບໍ່ແມ່ນແຄ່ເວລາທີ່ຈອງໄວ້) — ໃຊ້ຢືນຢັນວ່າກຳລັງໃຊ້ຫ້ອງແທ້ໆ ແລະ ກວດ no-show
    @Prop()
    checkedInAt?: Date;

    @Prop()
    checkedOutAt?: Date;

    // ລາຍຊື່ຄົນເຂົ້າຮ່ວມປະຊຸມ (ຊື່ຄົນ, ບໍ່ຈຳກັດວ່າຕ້ອງເປັນຜູ້ໃຊ້ໃນລະບົບ — ອາດມີແຂກພາຍນອກ)
    @Prop({ type: [String], default: [] })
    attendees!: string[];

    // ປະຫວັດການປ່ຽນແປງທັງໝົດຂອງການຈອງນີ້ (ເບິ່ງໄດ້ໃນ popup ລາຍລະອຽດ)
    @Prop({ type: [RoomBookingHistoryEntry], default: [] })
    history!: RoomBookingHistoryEntry[];
}

export const RoomBookingSchema = SchemaFactory.createForClass(RoomBooking);

RoomBookingSchema.index({ roomId: 1, startAt: 1, endAt: 1 });
RoomBookingSchema.index({ bookedBy: 1, status: 1 });