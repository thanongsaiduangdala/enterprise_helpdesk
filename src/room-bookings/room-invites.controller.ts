import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import type { Response } from 'express';
import { RoomInvitesService } from './room-invites.service';
import { AddInviteeDto, SetInviteModeDto } from './dto/invite.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

@Controller('room-bookings')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class RoomInvitesController {
    constructor(private invites: RoomInvitesService) { }

    @Get(':id/invite')
    @RequirePermission('rooms', 'read')
    get(@Param('id') id: string, @Req() req: any) {
        return this.invites.getInvite(id, req.user);
    }

    @Patch(':id/invite')
    @RequirePermission('rooms', 'read')
    setMode(@Param('id') id: string, @Body() dto: SetInviteModeDto, @Req() req: any) {
        return this.invites.setMode(id, req.user, dto);
    }

    @Get(':id/invite/accounts')
    @RequirePermission('rooms', 'read')
    searchAccounts(@Param('id') id: string, @Query('q') q: string | undefined, @Req() req: any) {
        return this.invites.searchAccounts(id, req.user, q);
    }

    @Post(':id/invitees')
    @RequirePermission('rooms', 'read')
    addInvitee(@Param('id') id: string, @Body() dto: AddInviteeDto, @Req() req: any) {
        return this.invites.addInvitee(id, req.user, dto);
    }

    @Delete(':id/invitees/:inviteeId')
    @RequirePermission('rooms', 'read')
    removeInvitee(@Param('id') id: string, @Param('inviteeId') inviteeId: string, @Req() req: any) {
        return this.invites.removeInvitee(id, req.user, inviteeId);
    }

    @Get(':id/invite/qr.pdf')
    @RequirePermission('rooms', 'read')
    async qrPdf(
        @Param('id') id: string,
        @Query('inviteeId') inviteeId: string | undefined,
        @Query('target') target: string | undefined,
        @Query('baseUrl') baseUrl: string | undefined,
        @Req() req: any,
        @Res() res: Response,
    ) {
        const pdf = await this.invites.buildQrPdf(id, req.user, { inviteeId, target, baseUrl });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="invite-qr-${id}.pdf"`);
        res.send(pdf);
    }

    @Get(':id/invite/attendance.csv')
    @RequirePermission('rooms', 'read')
    async csv(@Param('id') id: string, @Req() req: any, @Res() res: Response) {
        const { csv, filename } = await this.invites.buildCsv(id, req.user);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    }

    @Get(':id/invite/attendance.pdf')
    @RequirePermission('rooms', 'read')
    async reportPdf(@Param('id') id: string, @Req() req: any, @Res() res: Response) {
        const { pdf, filename } = await this.invites.buildReportPdf(id, req.user);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(pdf);
    }
}
