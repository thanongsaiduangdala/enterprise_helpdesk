import {
    Controller, Delete, Get, Param, Req, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { SessionsService } from './sessions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

@Controller('sessions')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SessionsController {
    constructor(private sessionsService: SessionsService) { }

    // Self-service — any logged-in user manages their own sessions
    @Get('me')
    findMine(@Req() req: any) {
        return this.sessionsService.findAllForUser(req.user.userId);
    }

    @Delete('me/:id')
    revokeMine(@Param('id') id: string, @Req() req: any) {
        return this.sessionsService.revokeOwn(id, req.user.userId);
    }

    // Admin — view/revoke any user's sessions
    @Get('user/:userId')
    @UseGuards(PermissionsGuard)
    @RequirePermission('sessions', 'read')
    findForUser(@Param('userId') userId: string) {
        return this.sessionsService.findAllForUserAsAdmin(userId);
    }

    @Delete(':id')
    @UseGuards(PermissionsGuard)
    @RequirePermission('sessions', 'delete')
    revokeAny(@Param('id') id: string) {
        return this.sessionsService.revokeAny(id);
    }
}