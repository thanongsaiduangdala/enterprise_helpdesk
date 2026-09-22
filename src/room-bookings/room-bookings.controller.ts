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
import { ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { RoomBookingsService } from './room-bookings.service';
import { CreateRoomBookingDto } from './dto/create-room-booking.dto';
import { RescheduleRoomBookingDto } from './dto/reschedule-room-booking.dto';
import { RejectRoomBookingDto } from './dto/reject-room-booking.dto';
import { RecordAttendeesDto } from './dto/record-attendees.dto';
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

    @Post('bulk-import')
    @RequirePermission('rooms', 'create')
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
        return this.bookingsService.bulkImport(file.buffer, req.user.userId);
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
        @Query('from') from: string,
        @Query('to') to: string,
        @Query('roomId') roomId?: string,
    ) {
        return this.bookingsService.findForRoom(
            parseRequiredDate(from, 'from'),
            parseRequiredDate(to, 'to'),
            roomId,
        );
    }

    @Patch(':id/reschedule')
    @RequirePermission('rooms', 'read')
    reschedule(@Param('id') id: string, @Body() dto: RescheduleRoomBookingDto, @Req() req: any) {
        return this.bookingsService.reschedule(id, dto, req.user.userId);
    }

    // ຢືນຢັນ "ເຂົ້າຫ້ອງແທ້ໆແລ້ວ" — ຄືກັບ reschedule/cancel, ຄວບຄຸມດ້ວຍ ownership (bookedBy) ພາຍໃນ service ບໍ່ແມ່ນ role
    @Patch(':id/checkin')
    @RequirePermission('rooms', 'read')
    checkIn(@Param('id') id: string, @Req() req: any) {
        return this.bookingsService.checkIn(id, req.user.userId);
    }

    @Patch(':id/checkout')
    @RequirePermission('rooms', 'read')
    checkOut(@Param('id') id: string, @Req() req: any) {
        return this.bookingsService.checkOut(id, req.user.userId);
    }

    @Patch(':id/attendees')
    @RequirePermission('rooms', 'read')
    recordAttendees(@Param('id') id: string, @Body() dto: RecordAttendeesDto, @Req() req: any) {
        return this.bookingsService.recordAttendees(id, req.user.userId, dto);
    }

    @Patch(':id/approve')
    @RequirePermission('rooms', 'approve')
    approve(@Param('id') id: string, @Req() req: any) {
        return this.bookingsService.approve(id, req.user.userId);
    }

    @Patch(':id/reject')
    @RequirePermission('rooms', 'approve')
    reject(@Param('id') id: string, @Body() dto: RejectRoomBookingDto, @Req() req: any) {
        return this.bookingsService.reject(id, req.user.userId, dto);
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