import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type DepartmentDocument = Department & Omit<Document, '_id'>;

@Schema({ timestamps: true })
export class Department {
    @Prop({ type: String })
    _id!: string;

    @Prop({ required: true })
    branchId!: string;

    @Prop({ required: true })
    name!: string;

    @Prop({ type: [String], default: [] })
    managerIds!: string[];

    @Prop({ default: true })
    isActive!: boolean;
}

export const DepartmentSchema = SchemaFactory.createForClass(Department);