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
}

export const RoomBookingSchema = SchemaFactory.createForClass(RoomBooking);

RoomBookingSchema.index({ roomId: 1, startAt: 1, endAt: 1 });
RoomBookingSchema.index({ bookedBy: 1, status: 1 });