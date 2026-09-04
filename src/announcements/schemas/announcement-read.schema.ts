import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AnnouncementReadDocument = AnnouncementRead & Document;

@Schema({ timestamps: false }) // readAt IS the timestamp — no need for separate createdAt/updatedAt
export class AnnouncementRead {
    @Prop({ type: String, ref: 'Announcement', required: true })
    announcementId!: string;

    @Prop({ type: Types.ObjectId, ref: 'User', required: true })
    userId!: Types.ObjectId;

    @Prop({ required: true, default: Date.now })
    readAt!: Date;
}

export const AnnouncementReadSchema = SchemaFactory.createForClass(AnnouncementRead);
// One read record per user per announcement — marking read twice is a no-op, not a duplicate.
AnnouncementReadSchema.index({ announcementId: 1, userId: 1 }, { unique: true });
