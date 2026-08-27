import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
export type UserDocument = User & Document;

@Schema({ _id: false })
class Mfa {
    @Prop({ default: false })
    enabled!: boolean;

    @Prop()
    method?: string;
}

@Schema({ _id: false })
class NotificationPrefs {
    @Prop({ default: true })
    emailTicketUpdates!: boolean;

    @Prop({ default: true })
    emailAnnouncements!: boolean;

    @Prop({ default: 'daily' })
    digest!: string;
}

@Schema({
    timestamps: true,
    toJSON: {
        transform: (_doc, ret: Record<string, any>) => {
            delete ret.passwordHash;
            return ret;
        },
    },
})
export class User {

    @Prop({ required: true, unique: true })
    employeeCode!: string;

    @Prop({ required: true })
    firstName!: string;

    @Prop({ required: true })
    lastName!: string;

    @Prop({ required: true, unique: true, lowercase: true, trim: true })
    email!: string;

    @Prop({ required: true })
    passwordHash!: string;

    @Prop({ unique: true, sparse: true })
    phone?: string;

    @Prop({ type: String, ref: 'Role', required: true })
    role!: string;

    @Prop({ required: true })
    branchId!: string;

    @Prop()
    departmentId?: string;

    @Prop({ default: true })
    isActive!: boolean;

    @Prop({ type: Mfa, default: () => ({}) })
    mfa!: Mfa;

    @Prop({ type: NotificationPrefs, default: () => ({}) })
    notificationPrefs!: NotificationPrefs;

    @Prop()
    lastLoginAt?: Date;

    @Prop()
    deactivatedAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
