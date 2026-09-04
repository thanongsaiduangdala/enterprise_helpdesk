import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { KbArticlesService } from './kb-articles.service';
import { CreateKbArticleDto } from './dto/create-kb-article.dto';
import { UpdateKbArticleDto } from './dto/update-kb-article.dto';
import { KbArticleFeedbackDto } from './dto/kb-article-feedback.dto';
import { KbArticleStatus } from './schemas/kb-article.schema';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

@Controller('kb-articles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class KbArticlesController {
    constructor(private articlesService: KbArticlesService) { }

    @Post()
    @RequirePermission('kb', 'create')
    create(@Body() dto: CreateKbArticleDto, @Req() req: any) {
        return this.articlesService.create(dto, req.user.userId);
    }

    @Get()
    @RequirePermission('kb', 'read')
    @ApiQuery({ name: 'departmentId', required: false })
    @ApiQuery({ name: 'category', required: false })
    @ApiQuery({ name: 'includeUnpublished', required: false, type: Boolean, description: 'Agent/admin view — also shows DRAFT/UNPUBLISHED articles' })
    findAll(
        @Query('departmentId') departmentId?: string,
        @Query('category') category?: string,
        @Query('includeUnpublished') includeUnpublished?: string,
    ) {
        return this.articlesService.findAll({
            departmentId,
            category,
            includeUnpublished: includeUnpublished === 'true',
        });
    }

    // Full search box — e.g. ?q=vpn+reset
    @Get('search')
    @RequirePermission('kb', 'read')
    search(@Query('q') q: string) {
        return this.articlesService.search(q);
    }

    // Live suggestions while typing a new ticket's title.
    @Get('suggest')
    @RequirePermission('kb', 'read')
    suggest(@Query('q') q: string) {
        return this.articlesService.suggest(q);
    }

    // "Admin/Agent: ... view most-viewed/least-helpful articles" — before ':id' so it's not swallowed by that route.
    @Get('analytics')
    @RequirePermission('kb', 'read')
    analytics() {
        return this.articlesService.analytics();
    }

    // Increments viewCount as a side effect of reading — see service for the caveat on that.
    @Get(':id')
    @RequirePermission('kb', 'read')
    findOne(@Param('id') id: string) {
        return this.articlesService.findOne(id);
    }

    @Patch(':id')
    @RequirePermission('kb', 'update')
    update(@Param('id') id: string, @Body() dto: UpdateKbArticleDto) {
        return this.articlesService.update(id, dto);
    }

    @Patch(':id/publish')
    @RequirePermission('kb', 'publish')
    publish(@Param('id') id: string) {
        return this.articlesService.setStatus(id, KbArticleStatus.PUBLISHED);
    }

    @Patch(':id/unpublish')
    @RequirePermission('kb', 'publish')
    unpublish(@Param('id') id: string) {
        return this.articlesService.setStatus(id, KbArticleStatus.UNPUBLISHED);
    }

    @Delete(':id')
    @RequirePermission('kb', 'delete')
    remove(@Param('id') id: string) {
        return this.articlesService.remove(id);
    }

    // Any authenticated employee can vote — deliberately not gated behind 'update'/'create',
    // since reading + voting should be available to whoever can read the article.
    @Post(':id/feedback')
    @RequirePermission('kb', 'read')
    submitFeedback(@Param('id') id: string, @Body() dto: KbArticleFeedbackDto, @Req() req: any) {
        return this.articlesService.submitFeedback(id, req.user.userId, dto);
    }
}
