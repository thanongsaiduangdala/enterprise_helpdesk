import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type RoomDocument = Room & Document;

export enum RoomStatus {
    AVAILABLE = 'AVAILABLE',
    MAINTENANCE = 'MAINTENANCE',
}

@Schema({ timestamps: true })
export class Room {
    @Prop({ type: String })
    _id!: string;

    @Prop({ type: String, ref: 'Branch', required: true })
    branchId!: string;

    @Prop({ required: true })
    name!: string;

    @Prop()
    location?: string; // e.g. '3rd Floor, East Wing' — where in the branch, distinct from branch.location

    @Prop({ required: true })
    capacity!: number;

    @Prop({ type: [String], default: [] })
    amenities!: string[];

    // Admin-controlled flag only (Available / Maintenance). "Booked" is NOT stored here —
    // it's computed live by checking roomBookings for a confirmed booking covering "now".
    // A room can be AVAILABLE and still show as live-booked for the current hour.
    @Prop({ enum: RoomStatus, default: RoomStatus.AVAILABLE })
    status!: RoomStatus;

    @Prop({ default: true })
    isActive!: boolean;
}

export const RoomSchema = SchemaFactory.createForClass(Room);
RoomSchema.index({ branchId: 1, name: 1 }, { unique: true });
