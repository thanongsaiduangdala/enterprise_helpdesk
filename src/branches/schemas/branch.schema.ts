import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type BranchDocument = Branch & Omit<Document, '_id'>;

@Schema({ _id: false })
class Location {
    @Prop({ required: true })
    address!: string;

    @Prop({ required: true })
    city!: string;

    @Prop({ required: true })
    country!: string;

    @Prop({ required: true })
    timezone!: string; // e.g. 'Asia/Vientiane' — IANA tz name, needed for SLA business-hours math
}

@Schema({ _id: false })
class DayHours {
    @Prop({
        required: true,
        enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
    })
    day!: string;

    @Prop({ default: true })
    isOpen!: boolean;

    @Prop({ example: '09:00' })
    open?: string; // 24h "HH:mm", omit/ignore when isOpen is false

    @Prop({ example: '18:00' })
    close?: string;
}

@Schema({ _id: false })
class Holiday {
    @Prop({ required: true })
    date!: Date;

    @Prop({ required: true })
    name!: string; // e.g. 'Lao New Year'
}

@Schema({ timestamps: true })
export class Branch {
    @Prop({ type: String })
    _id!: string;

    @Prop({ required: true, unique: true })
    name!: string;

    @Prop({ type: Location, required: true })
    location!: Location;

    @Prop({ type: [DayHours], default: [] })
    businessHours!: DayHours[];

    @Prop({ type: [Holiday], default: [] })
    holidays!: Holiday[];

    @Prop({ default: true })
    isActive!: boolean;
}

export const BranchSchema = SchemaFactory.createForClass(Branch);