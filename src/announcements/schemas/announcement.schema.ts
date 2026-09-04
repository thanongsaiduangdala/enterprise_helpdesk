import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AnnouncementDocument = Announcement & Omit<Document, '_id'>;

export enum AnnouncementScope {
    COMPANY = 'COMPANY',
    BRANCH = 'BRANCH',
    DEPARTMENT = 'DEPARTMENT',
}

@Schema({ timestamps: true })
export class Announcement {
    @Prop({ type: String })
    _id!: string; // e.g. 'AN001' — see AnnouncementsService.generateId() for the gap-filling logic

    @Prop({ required: true })
    title!: string;

    @Prop({ required: true })
    body!: string;

    @Prop({ enum: AnnouncementScope, required: true })
    scope!: AnnouncementScope;

    // Only set when scope is BRANCH (company-wide announcements leave this unset).
    @Prop({ type: String, ref: 'Branch' })
    branchId?: string;

    // Only set when scope is DEPARTMENT.
    @Prop({ type: String, ref: 'Department' })
    departmentId?: string;

    // Defaults to "now" at creation if omitted — see service. Gates visibility on the dashboard feed.
    @Prop({ required: true })
    publishAt!: Date;

    @Prop()
    expireAt?: Date;

    @Prop({ default: false })
    pinned!: boolean;

    @Prop({ type: Types.ObjectId, ref: 'User', required: true })
    createdBy!: Types.ObjectId;
}

export const AnnouncementSchema = SchemaFactory.createForClass(Announcement);
AnnouncementSchema.index({ scope: 1, branchId: 1, departmentId: 1 });
AnnouncementSchema.index({ publishAt: 1, expireAt: 1 });
