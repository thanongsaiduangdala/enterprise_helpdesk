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

@Controller('room-bookings')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class RoomBookingsController {
    constructor(private bookingsService: RoomBookingsService) { }

    // NOTE: assumes JwtAuthGuard attaches the decoded token to req.user (req.user.userId).
    // Swap @Req() for whatever @CurrentUser() decorator the rest of the codebase already uses, if one exists.

    @Post()
    @RequirePermission('rooms', 'read') // any authenticated employee can book a room — rename to a 'bookings' permission if you want it tracked separately from room admin
    create(@Body() dto: CreateRoomBookingDto, @Req() req: any) {
        return this.bookingsService.create(dto, req.user.userId);
    }

    @Get('my')
    @RequirePermission('rooms', 'read')
    findMine(@Req() req: any) {
        return this.bookingsService.findMyBookings(req.user.userId);
    }

    // Room calendar view (day/week) — e.g. ?roomId=...&from=2026-09-01&to=2026-09-08
    @Get()
    @RequirePermission('rooms', 'read')
    findForRoom(
        @Query('roomId') roomId: string,
        @Query('from') from: string,
        @Query('to') to: string,
    ) {
        return this.bookingsService.findForRoom(roomId, new Date(from), new Date(to));
    }

    @Patch(':id/reschedule')
    @RequirePermission('rooms', 'read')
    reschedule(@Param('id') id: string, @Body() dto: RescheduleRoomBookingDto, @Req() req: any) {
        return this.bookingsService.reschedule(id, dto, req.user.userId);
    }

    // Cancel is a soft delete (status -> CANCELLED), not a hard delete — see service layer.
    @Delete(':id')
    @RequirePermission('rooms', 'read')
    cancel(@Param('id') id: string, @Req() req: any) {
        return this.bookingsService.cancel(id, req.user.userId);
    }
}
