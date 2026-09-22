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
    UploadedFile,
    UseInterceptors,
    UseGuards,
    BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiBody, ApiQuery } from '@nestjs/swagger';
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
        return this.articlesService.create(dto, req.user.userId, req.user.permissions);
    }

    @Post('bulk-import')
    @RequirePermission('kb', 'create')
    @UseInterceptors(FileInterceptor('file'))
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: { file: { type: 'string', format: 'binary' } },
        },
    })
    bulkImport(@UploadedFile() file: Express.Multer.File, @Req() req: any) {
        if (!file) {
            throw new BadRequestException('No file uploaded — expected a CSV file under field name "file"');
        }
        return this.articlesService.bulkImport(file.buffer, req.user.userId, req.user.permissions);
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
        @Req() req?: any,
    ) {
        return this.articlesService.findAll(
            {
                departmentId,
                category,
                includeUnpublished: includeUnpublished === 'true',
            },
            req.user.permissions,
        );
    }


    @Get('search')
    @RequirePermission('kb', 'read')
    search(@Query('q') q: string) {
        return this.articlesService.search(q);
    }


    @Get('suggest')
    @RequirePermission('kb', 'read')
    suggest(@Query('q') q: string) {
        return this.articlesService.suggest(q);
    }


    @Get('analytics')
    @RequirePermission('kb', 'read')
    analytics() {
        return this.articlesService.analytics();
    }


    @Get(':id')
    @RequirePermission('kb', 'read')
    findOne(@Param('id') id: string, @Req() req: any) {
        return this.articlesService.findOne(id, req.user.permissions);
    }

    @Patch(':id')
    @RequirePermission('kb', 'update')
    update(@Param('id') id: string, @Body() dto: UpdateKbArticleDto, @Req() req: any) {
        return this.articlesService.update(id, dto, req.user.userId, req.user.permissions);
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
    remove(@Param('id') id: string, @Req() req: any) {
        return this.articlesService.remove(id, req.user.userId, req.user.permissions);
    }



    @Post(':id/feedback')
    @RequirePermission('kb', 'read')
    submitFeedback(@Param('id') id: string, @Body() dto: KbArticleFeedbackDto, @Req() req: any) {
        return this.articlesService.submitFeedback(id, req.user.userId, dto, req.user.permissions);
    }
}