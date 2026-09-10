import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type RoomBookingLockDocument = RoomBookingLock & Omit<Document, '_id'>;

@Schema({ timestamps: false })
export class RoomBookingLock {
    @Prop({ type: String })
    _id!: string;

    @Prop({ required: true, default: Date.now })
    lockedAt!: Date;
}

export const RoomBookingLockSchema = SchemaFactory.createForClass(RoomBookingLock);
RoomBookingLockSchema.index({ lockedAt: 1 }, { expireAfterSeconds: 30 });