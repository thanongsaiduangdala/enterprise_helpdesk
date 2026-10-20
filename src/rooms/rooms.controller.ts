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
import { ApiBearerAuth, ApiConsumes, ApiBody, ApiQuery } from '@nestjs/swagger';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { RoomStatus } from './schemas/room.schema';
import { SetRoomStatusDto } from './dto/set-room-status.dto';
import { CreateRoomMaintenanceDto } from './dto/create-room-maintenance.dto';
import { UpdateRoomMaintenanceDto } from './dto/update-room-maintenance.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { parseRequiredDate } from '../common/utils/parse-date.util';

@Controller('rooms')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class RoomsController {
  constructor(private roomsService: RoomsService) {}

  @Post()
  @RequirePermission('rooms', 'manage')
  create(@Body() dto: CreateRoomDto) {
    return this.roomsService.create(dto);
  }

  @Post('bulk-import')
  @RequirePermission('rooms', 'import')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  bulkImport(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException(
        'No file uploaded — expected a CSV file under field name "file"',
      );
    }
    return this.roomsService.bulkImport(file.buffer);
  }

  @Get()
  @RequirePermission('rooms', 'read')
  @ApiQuery({
    name: 'branchId',
    required: false,
    description: 'Filter by branch — omit to get all rooms across every branch',
  })
  findAll(@Query('branchId') branchId?: string) {
    return this.roomsService.findAllWithLiveStatus(branchId);
  }

  @Get('available')
  @RequirePermission('rooms', 'read')
  @ApiQuery({ name: 'from', description: 'ISO start datetime' })
  @ApiQuery({ name: 'to', description: 'ISO end datetime' })
  @ApiQuery({ name: 'branchId', required: false })
  findAvailable(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.roomsService.findAvailableBetween(
      parseRequiredDate(from, 'from'),
      parseRequiredDate(to, 'to'),
      branchId,
    );
  }

  @Get('utilization')
  @RequirePermission('rooms', 'manage')
  utilization(@Query('from') from: string, @Query('to') to: string) {
    return this.roomsService.utilization(new Date(from), new Date(to));
  }

  @Get('maintenance')
  @RequirePermission('rooms', 'read')
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'roomId', required: false })
  listMaintenance(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('roomId') roomId?: string,
  ) {
    return this.roomsService.listMaintenance(
      from ? parseRequiredDate(from, 'from') : undefined,
      to ? parseRequiredDate(to, 'to') : undefined,
      roomId,
    );
  }

  @Get('maintenance/affected')
  @RequirePermission('rooms', 'update')
  affectedByMaintenance() {
    return this.roomsService.affectedByMaintenance();
  }

  @Patch('maintenance/:windowId')
  @RequirePermission('rooms', 'update')
  updateMaintenance(
    @Param('windowId') windowId: string,
    @Body() dto: UpdateRoomMaintenanceDto,
  ) {
    return this.roomsService.updateMaintenance(windowId, dto);
  }

  @Delete('maintenance/:windowId')
  @RequirePermission('rooms', 'update')
  removeMaintenance(@Param('windowId') windowId: string) {
    return this.roomsService.removeMaintenance(windowId);
  }

  @Get(':id/maintenance-impact')
  @RequirePermission('rooms', 'update')
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  maintenanceImpact(
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.roomsService.maintenanceImpact(
      id,
      from ? parseRequiredDate(from, 'from') : new Date(),
      to ? parseRequiredDate(to, 'to') : undefined,
    );
  }

  @Post(':id/maintenance')
  @RequirePermission('rooms', 'update')
  createMaintenance(
    @Param('id') id: string,
    @Body() dto: CreateRoomMaintenanceDto,
    @Req() req: any,
  ) {
    return this.roomsService.createMaintenance(id, dto, req.user.userId);
  }

  @Get(':id')
  @RequirePermission('rooms', 'read')
  findOne(@Param('id') id: string) {
    return this.roomsService.findOneWithLiveStatus(id);
  }

  @Patch(':id')
  @RequirePermission('rooms', 'update')
  update(@Param('id') id: string, @Body() dto: UpdateRoomDto) {
    return this.roomsService.update(id, dto);
  }

  @Patch(':id/status')
  @RequirePermission('rooms', 'update')
  setStatus(@Param('id') id: string, @Body() dto: SetRoomStatusDto) {
    return this.roomsService.setStatus(id, dto.status);
  }

  @Delete(':id')
  @RequirePermission('rooms', 'delete')
  remove(@Param('id') id: string) {
    return this.roomsService.remove(id);
  }
}
