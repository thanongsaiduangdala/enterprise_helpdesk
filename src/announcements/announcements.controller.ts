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
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

@Controller('announcements')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class AnnouncementsController {
    constructor(private announcementsService: AnnouncementsService) { }

    @Post()
    @RequirePermission('announcements', 'create')
    create(@Body() dto: CreateAnnouncementDto, @Req() req: any) {
        return this.announcementsService.create(dto, req.user.userId);
    }

    // Admin management list — everything, any publish window.
    @Get()
    @RequirePermission('announcements', 'read')
    findAll() {
        return this.announcementsService.findAll();
    }

    // The actual dashboard feed. branchId/departmentId passed as query params for now —
    // see the NOTE in the service about wiring these from the authenticated user's own record.
    @Get('active')
    @RequirePermission('announcements', 'read')
    @ApiQuery({ name: 'branchId', required: false })
    @ApiQuery({ name: 'departmentId', required: false })
    findActive(
        @Req() req: any,
        @Query('branchId') branchId?: string,
        @Query('departmentId') departmentId?: string,
    ): Promise<Array<Record<string, any>>> {
        return this.announcementsService.findActiveForUser(req.user.userId, branchId, departmentId);
    }

    @Get(':id')
    @RequirePermission('announcements', 'read')
    findOne(@Param('id') id: string) {
        return this.announcementsService.findOne(id);
    }

    @Patch(':id')
    @RequirePermission('announcements', 'update')
    update(@Param('id') id: string, @Body() dto: UpdateAnnouncementDto) {
        return this.announcementsService.update(id, dto);
    }

    @Patch(':id/pin')
    @RequirePermission('announcements', 'update')
    pin(@Param('id') id: string) {
        return this.announcementsService.setPinned(id, true);
    }

    @Patch(':id/unpin')
    @RequirePermission('announcements', 'update')
    unpin(@Param('id') id: string) {
        return this.announcementsService.setPinned(id, false);
    }

    @Delete(':id')
    @RequirePermission('announcements', 'delete')
    remove(@Param('id') id: string) {
        return this.announcementsService.remove(id);
    }

    // Marking read is a personal action, not an admin one — gated on 'read' rather than
    // 'update' since every role that can see announcements should be able to mark them read.
    @Post(':id/read')
    @RequirePermission('announcements', 'read')
    markRead(@Param('id') id: string, @Req() req: any) {
        return this.announcementsService.markRead(id, req.user.userId);
    }

    @Get(':id/reads')
    @RequirePermission('announcements', 'read')
    whoRead(@Param('id') id: string) {
        return this.announcementsService.whoRead(id);
    }
}
