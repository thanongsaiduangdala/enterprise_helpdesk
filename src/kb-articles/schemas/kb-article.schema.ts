import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type KbArticleDocument = KbArticle & Omit<Document, '_id'>;

export enum KbArticleStatus {
    DRAFT = 'DRAFT',
    PUBLISHED = 'PUBLISHED',
    UNPUBLISHED = 'UNPUBLISHED',
}

@Schema({ timestamps: true })
export class KbArticle {
    @Prop({ type: String })
    _id!: string; // e.g. 'KB001' — see KbArticlesService.generateId() for the gap-filling logic

    @Prop({ required: true })
    title!: string;

    @Prop({ required: true })
    body!: string;

    @Prop({ required: true })
    category!: string;

    @Prop({ type: String, ref: 'Department', required: true })
    departmentId!: string;

    @Prop({ type: [String], default: [] })
    tags!: string[];

    @Prop({ enum: KbArticleStatus, default: KbArticleStatus.DRAFT })
    status!: KbArticleStatus;

    @Prop({ type: Types.ObjectId, ref: 'User', required: true })
    authorId!: Types.ObjectId;

    @Prop({ default: 0 })
    viewCount!: number;

    @Prop({ default: 0 })
    helpfulCount!: number;

    @Prop({ default: 0 })
    notHelpfulCount!: number;
}

export const KbArticleSchema = SchemaFactory.createForClass(KbArticle);
KbArticleSchema.index({ departmentId: 1, status: 1 });
// Powers both the search box and the "suggest while typing a ticket" feature.
KbArticleSchema.index({ title: 'text', body: 'text', tags: 'text' });
