import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type KbArticleFeedbackDocument = KbArticleFeedback & Document;

@Schema({ timestamps: true })
export class KbArticleFeedback {
    @Prop({ type: String, ref: 'KbArticle', required: true })
    articleId!: string;

    @Prop({ type: Types.ObjectId, ref: 'User', required: true })
    userId!: Types.ObjectId;

    @Prop({ required: true })
    helpful!: boolean; // true = 👍, false = 👎
}

export const KbArticleFeedbackSchema = SchemaFactory.createForClass(KbArticleFeedback);
// One vote per user per article — re-voting updates this record instead of creating a duplicate.
KbArticleFeedbackSchema.index({ articleId: 1, userId: 1 }, { unique: true });
