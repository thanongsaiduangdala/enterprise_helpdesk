import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AuditLogsService } from './audit-logs.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';






@Controller('audit-logs')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class AuditLogsController {
    constructor(private auditLogsService: AuditLogsService) { }

    @Get()
    @RequirePermission('audit-logs', 'read')
    @ApiQuery({ name: 'actorId', required: false })
    @ApiQuery({ name: 'entityType', required: false })
    @ApiQuery({ name: 'entityId', required: false })
    @ApiQuery({ name: 'from', required: false, description: 'ISO date' })
    @ApiQuery({ name: 'to', required: false, description: 'ISO date' })
    findAll(
        @Query('actorId') actorId?: string,
        @Query('entityType') entityType?: string,
        @Query('entityId') entityId?: string,
        @Query('from') from?: string,
        @Query('to') to?: string,
    ) {
        return this.auditLogsService.findAll({
            actorId,
            entityType,
            entityId,
            from: from ? new Date(from) : undefined,
            to: to ? new Date(to) : undefined,
        });
    }



    @Get('verify')
    @RequirePermission('audit-logs', 'read')
    verify() {
        return this.auditLogsService.verifyChain();
    }

    @Get(':id')
    @RequirePermission('audit-logs', 'read')
    findOne(@Param('id') id: string) {
        return this.auditLogsService.findOne(id);
    }
}
