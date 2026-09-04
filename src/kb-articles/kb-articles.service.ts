import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { KbArticle, KbArticleDocument, KbArticleStatus } from './schemas/kb-article.schema';
import { KbArticleFeedback, KbArticleFeedbackDocument } from './schemas/kb-article-feedback.schema';
import { CreateKbArticleDto } from './dto/create-kb-article.dto';
import { UpdateKbArticleDto } from './dto/update-kb-article.dto';
import { KbArticleFeedbackDto } from './dto/kb-article-feedback.dto';

@Injectable()
export class KbArticlesService {
    constructor(
        @InjectModel(KbArticle.name) private articleModel: Model<KbArticleDocument>,
        @InjectModel(KbArticleFeedback.name) private feedbackModel: Model<KbArticleFeedbackDocument>,
    ) { }

    // Same gap-filling pattern as the other custom-ID collections.
    private async generateId(): Promise<string> {
        const articles = await this.articleModel
            .find({ _id: /^KB\d{3}$/ }, { _id: 1 })
            .sort({ _id: 1 })
            .exec();
        const usedNumbers = new Set(articles.map((a) => parseInt(a._id.slice(2), 10)));
        let seq = 1;
        while (usedNumbers.has(seq)) seq++;
        return `KB${String(seq).padStart(3, '0')}`;
    }

    async create(dto: CreateKbArticleDto, authorId: string) {
        const existing = await this.articleModel.findOne({ title: dto.title, departmentId: dto.departmentId });
        if (existing) {
            throw new ConflictException(`An article titled "${dto.title}" already exists in this department`);
        }
        const _id = await this.generateId();
        return new this.articleModel({ _id, ...dto, authorId }).save();
    }

    // General browse/filter view — e.g. ?departmentId=DX001&category=Networking
    // Employees should only see PUBLISHED articles; pass includeUnpublished=true for
    // the agent/admin management view that also shows DRAFT/UNPUBLISHED ones.
    findAll(filters: { departmentId?: string; category?: string; includeUnpublished?: boolean }) {
        const query: any = {};
        if (filters.departmentId) query.departmentId = filters.departmentId;
        if (filters.category) query.category = filters.category;
        if (!filters.includeUnpublished) query.status = KbArticleStatus.PUBLISHED;
        return this.articleModel.find(query).sort({ title: 1 }).exec();
    }

    // Full-text search box — only ever searches published articles, since this is
    // the employee-facing "search before you file a ticket" flow.
    search(q: string) {
        return this.articleModel
            .find({ $text: { $search: q }, status: KbArticleStatus.PUBLISHED }, { score: { $meta: 'textScore' } })
            .sort({ score: { $meta: 'textScore' } })
            .limit(20)
            .exec();
    }

    // "Suggest relevant articles live while typing a new ticket" — same as search()
    // but capped tighter (top 5) since it's meant to render inline under a text field, not a full results page.
    suggest(q: string) {
        if (!q || q.trim().length < 3) return []; // avoid noisy matches on 1-2 characters while typing
        return this.articleModel
            .find({ $text: { $search: q }, status: KbArticleStatus.PUBLISHED }, { score: { $meta: 'textScore' } })
            .sort({ score: { $meta: 'textScore' } })
            .limit(5)
            .select('title category viewCount')
            .exec();
    }

    // Increments viewCount on every read — a simple counter, not deduplicated per user.
    // Fine for this project's scale; if you need unique-viewer counts later, that would
    // need the same per-user tracking pattern as the feedback collection below.
    async findOne(id: string) {
        const article = await this.articleModel
            .findByIdAndUpdate(id, { $inc: { viewCount: 1 } }, { new: true })
            .exec();
        if (!article) throw new NotFoundException('Article not found');
        return article;
    }

    async update(id: string, dto: UpdateKbArticleDto) {
        const article = await this.articleModel.findByIdAndUpdate(id, dto, { new: true }).exec();
        if (!article) throw new NotFoundException('Article not found');
        return article;
    }

    async setStatus(id: string, status: KbArticleStatus) {
        const article = await this.articleModel.findByIdAndUpdate(id, { status }, { new: true }).exec();
        if (!article) throw new NotFoundException('Article not found');
        return article;
    }

    async remove(id: string) {
        const result = await this.articleModel.findByIdAndDelete(id).exec();
        if (!result) throw new NotFoundException('Article not found');
        await this.feedbackModel.deleteMany({ articleId: id }).exec(); // clean up orphaned votes
        return { deleted: true };
    }

    // "Was this helpful?" — handles first-time vote, no-op on an identical repeat vote,
    // and correctly moves the counts if someone changes their mind (👍 -> 👎 or vice versa).
    async submitFeedback(articleId: string, userId: string, dto: KbArticleFeedbackDto) {
        const article = await this.articleModel.findById(articleId).exec();
        if (!article) throw new NotFoundException('Article not found');

        const existing = await this.feedbackModel.findOne({ articleId, userId }).exec();

        if (!existing) {
            await this.feedbackModel.create({ articleId, userId, helpful: dto.helpful });
            await this.articleModel.findByIdAndUpdate(articleId, {
                $inc: dto.helpful ? { helpfulCount: 1 } : { notHelpfulCount: 1 },
            });
        } else if (existing.helpful !== dto.helpful) {
            existing.helpful = dto.helpful;
            await existing.save();
            await this.articleModel.findByIdAndUpdate(articleId, {
                $inc: dto.helpful
                    ? { helpfulCount: 1, notHelpfulCount: -1 }
                    : { helpfulCount: -1, notHelpfulCount: 1 },
            });
        }
        // else: identical repeat vote, nothing to change

        return this.articleModel.findById(articleId).exec();
    }

    // "Admin/Agent: ... view most-viewed/least-helpful articles"
    async analytics() {
        const mostViewed = await this.articleModel
            .find({ status: KbArticleStatus.PUBLISHED })
            .sort({ viewCount: -1 })
            .limit(10)
            .select('title viewCount')
            .exec();

        const leastHelpful = await this.articleModel
            .find({ status: KbArticleStatus.PUBLISHED, $expr: { $gt: [{ $add: ['$helpfulCount', '$notHelpfulCount'] }, 0] } })
            .sort({ notHelpfulCount: -1 })
            .limit(10)
            .select('title helpfulCount notHelpfulCount')
            .exec();

        return { mostViewed, leastHelpful };
    }
}
