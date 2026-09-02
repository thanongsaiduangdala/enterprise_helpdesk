import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type RoomBookingDocument = RoomBooking & Document;

export enum BookingStatus {
    CONFIRMED = 'CONFIRMED',
    CANCELLED = 'CANCELLED',
}

@Schema({ _id: false })
class Recurrence {
    @Prop({ required: true, enum: ['daily', 'weekly'] })
    frequency!: string;

    @Prop({ required: true })
    until!: Date; // last date this recurrence pattern applies to
}

@Schema({ timestamps: true })
export class RoomBooking {
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

    @Prop({ enum: BookingStatus, default: BookingStatus.CONFIRMED })
    status!: BookingStatus;
}

export const RoomBookingSchema = SchemaFactory.createForClass(RoomBooking);
// Speeds up both the conflict check and the room-calendar view (both filter by roomId + time range)
RoomBookingSchema.index({ roomId: 1, startAt: 1, endAt: 1 });
RoomBookingSchema.index({ bookedBy: 1, status: 1 });