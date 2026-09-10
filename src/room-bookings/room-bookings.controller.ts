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

    // Gated on 'create' rather than 'read' — booking a NEW slot isn't a personal action
    // with anything to check ownership against yet, unlike reschedule/cancel below, so
    // it deserves its own distinct permission rather than piggybacking on 'read'.
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

    // Reschedule/cancel stay on 'read' deliberately — these are personal actions on your
    // OWN booking, the same reasoning already applied to ticket-message creation and
    // CSAT feedback elsewhere in this codebase. The real security boundary is the
    // ownership check inside the service (bookedBy === requesterId), not this permission.
    @Patch(':id/reschedule')
    @RequirePermission('rooms', 'read')
    reschedule(@Param('id') id: string, @Body() dto: RescheduleRoomBookingDto, @Req() req: any) {
        return this.bookingsService.reschedule(id, dto, req.user.userId);
    }

    @Delete(':id')
    @RequirePermission('rooms', 'read')
    cancel(@Param('id') id: string, @Req() req: any) {
        return this.bookingsService.cancel(id, req.user.userId);
    }
}