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
import { MaintenanceHistoryService } from './maintenance-history.service';
import { CreateMaintenanceRecordDto } from './dto/create-maintenance-record.dto';
import { UpdateMaintenanceRecordDto } from './dto/update-maintenance-record.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { MaintenanceStatus } from './schemas/maintenance-history.schema';

@Controller('maintenance-history')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class MaintenanceHistoryController {
  constructor(private maintenanceHistoryService: MaintenanceHistoryService) {}

  @Post()
  @RequirePermission('assets', 'update')
  create(@Body() dto: CreateMaintenanceRecordDto, @Req() req: any) {
    return this.maintenanceHistoryService.create(dto, req.user.userId);
  }

  @Get()
  @RequirePermission('assets', 'read')
  @ApiQuery({ name: 'assetId', required: false })
  @ApiQuery({ name: 'status', required: false, enum: MaintenanceStatus })
  findAll(
    @Query('assetId') assetId?: string,
    @Query('status') status?: MaintenanceStatus,
  ) {
    return this.maintenanceHistoryService.findAll({ assetId, status });
  }

  @Get('asset/:assetId')
  @RequirePermission('assets', 'read')
  findByAssetId(@Param('assetId') assetId: string) {
    return this.maintenanceHistoryService.findByAssetId(assetId);
  }

  @Get(':id')
  @RequirePermission('assets', 'read')
  findOne(@Param('id') id: string) {
    return this.maintenanceHistoryService.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('assets', 'update')
  update(@Param('id') id: string, @Body() dto: UpdateMaintenanceRecordDto) {
    return this.maintenanceHistoryService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('assets', 'delete')
  remove(@Param('id') id: string) {
    return this.maintenanceHistoryService.remove(id);
  }
}
