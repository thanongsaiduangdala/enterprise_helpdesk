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
    location?: string;

    @Prop({ required: true })
    capacity!: number;

    @Prop({ type: [String], default: [] })
    amenities!: string[];




    @Prop({ enum: RoomStatus, default: RoomStatus.AVAILABLE })
    status!: RoomStatus;

    @Prop({ default: true })
    isActive!: boolean;
}

export const RoomSchema = SchemaFactory.createForClass(Room);
RoomSchema.index({ branchId: 1, name: 1 }, { unique: true });
