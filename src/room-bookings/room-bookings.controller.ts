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
import { ApiBearerAuth } from '@nestjs/swagger';
import { RoomBookingsService } from './room-bookings.service';
import { CreateRoomBookingDto } from './dto/create-room-booking.dto';
import { RescheduleRoomBookingDto } from './dto/reschedule-room-booking.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { parseRequiredDate } from '../common/utils/parse-date.util';

@Controller('room-bookings')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class RoomBookingsController {
    constructor(private bookingsService: RoomBookingsService) { }

    @Post()
    @RequirePermission('rooms', 'create')
    create(@Body() dto: CreateRoomBookingDto, @Req() req: any) {
        return this.bookingsService.create(dto, req.user.userId);
    }

    @Get('my')
    @RequirePermission('rooms', 'read')
    findMine(@Req() req: any) {
        return this.bookingsService.findMyBookings(req.user.userId);
    }

    @Get('pending')
    @RequirePermission('rooms', 'approve')
    findPending() {
        return this.bookingsService.findPendingApprovals();
    }

    @Get()
    @RequirePermission('rooms', 'read')
    findForRoom(
        @Query('roomId') roomId: string,
        @Query('from') from: string,
        @Query('to') to: string,
    ) {
        return this.bookingsService.findForRoom(
            roomId,
            parseRequiredDate(from, 'from'),
            parseRequiredDate(to, 'to'),
        );
    }

    @Patch(':id/reschedule')
    @RequirePermission('rooms', 'read')
    reschedule(@Param('id') id: string, @Body() dto: RescheduleRoomBookingDto, @Req() req: any) {
        return this.bookingsService.reschedule(id, dto, req.user.userId);
    }

    @Patch(':id/approve')
    @RequirePermission('rooms', 'approve')
    approve(@Param('id') id: string, @Req() req: any) {
        return this.bookingsService.approve(id, req.user.userId);
    }

    @Patch(':id/reject')
    @RequirePermission('rooms', 'approve')
    reject(@Param('id') id: string, @Req() req: any) {
        return this.bookingsService.reject(id, req.user.userId);
    }

    @Delete(':id')
    @RequirePermission('rooms', 'read')
    cancel(@Param('id') id: string, @Req() req: any) {
        return this.bookingsService.cancel(id, req.user.userId);
    }

    @Delete('series/:seriesId')
    @RequirePermission('rooms', 'read')
    cancelSeries(@Param('seriesId') seriesId: string, @Req() req: any) {
        return this.bookingsService.cancelSeries(seriesId, req.user.userId);
    }
}