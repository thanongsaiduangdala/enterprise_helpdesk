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
import { PoprService } from './popr.service';
import { CreatePoprRecordDto } from './dto/create-popr-record.dto';
import { UpdatePoprRecordDto } from './dto/update-popr-record.dto';
import { PoprStatus } from './schemas/popr-record.schema';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Controller('popr-records')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class PoprController {
    constructor(
        private poprService: PoprService,
        private auditLogsService: AuditLogsService,
    ) { }

    @Post()
    @RequirePermission('supplies', 'manage')
    async create(@Body() dto: CreatePoprRecordDto, @Req() req: any) {
        const record = await this.poprService.create(dto, req.user.userId);
        await this.auditLogsService.log(
            req.user.userId, 'POPR_CREATED', 'PoprRecord', record._id,
            undefined, { status: record.status, stage: record.stage }, req.ip,
        );
        return record;
    }

    @Get()
    @RequirePermission('supplies', 'read')
    @ApiQuery({ name: 'status', required: false, enum: PoprStatus })
    @ApiQuery({ name: 'q', required: false, description: 'Search item, vendor, PO, S/N, asset tag, assignee' })
    findAll(@Query('status') status?: PoprStatus, @Query('q') q?: string) {
        return this.poprService.findAll({ status, q });
    }

    @Get(':id')
    @RequirePermission('supplies', 'read')
    findOne(@Param('id') id: string) {
        return this.poprService.findOne(id);
    }

    @Patch(':id')
    @RequirePermission('supplies', 'manage')
    async update(@Param('id') id: string, @Body() dto: UpdatePoprRecordDto, @Req() req: any) {
        const record = await this.poprService.update(id, dto);
        await this.auditLogsService.log(
            req.user.userId, 'POPR_UPDATED', 'PoprRecord', id,
            undefined, { status: record.status, stage: record.stage }, req.ip,
        );
        return record;
    }

    @Patch(':id/complete')
    @RequirePermission('supplies', 'manage')
    async complete(@Param('id') id: string, @Req() req: any) {
        const record = await this.poprService.complete(id);
        await this.auditLogsService.log(
            req.user.userId, 'POPR_COMPLETED', 'PoprRecord', id,
            undefined, { status: record.status, completedAt: record.completedAt }, req.ip,
        );
        return record;
    }

    @Delete(':id')
    @RequirePermission('supplies', 'delete')
    async remove(@Param('id') id: string, @Req() req: any) {
        const result = await this.poprService.remove(id);
        await this.auditLogsService.log(
            req.user.userId, 'POPR_DELETED', 'PoprRecord', id, undefined, undefined, req.ip,
        );
        return result;
    }
}
