import { Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

// NOTE: no PermissionsGuard/RequirePermission here, deliberately. Your permissions JSON
// has no 'notifications' module — and conceptually it shouldn't need one: every role
// should always be able to see and manage their OWN notification inbox regardless of
// what else they're permitted to do. Only JwtAuthGuard (must be logged in) applies.
// There's also no POST endpoint — notifications are only ever system-generated via
// NotificationsService.notify() called from other modules, never created by a user directly.

@Controller('notifications')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class NotificationsController {
    constructor(private notificationsService: NotificationsService) { }

    @Get('my')
    @ApiQuery({ name: 'unreadOnly', required: false, type: Boolean })
    findMine(@Req() req: any, @Query('unreadOnly') unreadOnly?: string) {
        return this.notificationsService.findMine(req.user.userId, unreadOnly === 'true');
    }

    @Get('unread-count')
    unreadCount(@Req() req: any) {
        return this.notificationsService.unreadCount(req.user.userId);
    }

    @Patch(':id/read')
    markRead(@Param('id') id: string, @Req() req: any) {
        return this.notificationsService.markRead(id, req.user.userId);
    }

    @Patch('read-all')
    markAllRead(@Req() req: any) {
        return this.notificationsService.markAllRead(req.user.userId);
    }
}
