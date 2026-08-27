import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type RoleDocument = Role & Omit<Document, '_id'>;

@Schema({ _id: false })
class Permission {
    @Prop({ required: true })
    module!: string;

    @Prop({ type: [String], required: true })
    actions!: string[];
}

@Schema({ timestamps: true })
export class Role {
    @Prop({ type: String })
    _id!: string;

    @Prop({ required: true, unique: true })
    name!: string;

    @Prop({ default: false })
    isSystemRole!: boolean;

    @Prop({ type: [Permission], default: [] })
    permissions!: Permission[];

    @Prop({ default: false })
    mfaRequired!: boolean;
}

export const RoleSchema = SchemaFactory.createForClass(Role);