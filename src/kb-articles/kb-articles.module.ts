import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { KbArticle, KbArticleSchema } from './schemas/kb-article.schema';
import { KbArticleFeedback, KbArticleFeedbackSchema } from './schemas/kb-article-feedback.schema';
import { KbArticlesService } from './kb-articles.service';
import { KbArticlesController } from './kb-articles.controller';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: KbArticle.name, schema: KbArticleSchema },
            { name: KbArticleFeedback.name, schema: KbArticleFeedbackSchema },
        ]),
    ],
    controllers: [KbArticlesController],
    providers: [KbArticlesService],
    exports: [KbArticlesService],
})
export class KbArticlesModule { }
