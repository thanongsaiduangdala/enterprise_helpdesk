import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { PoprService } from './popr.service';
import { CreatePoprRecordDto } from './dto/create-popr-record.dto';
import { UpdatePoprRecordDto } from './dto/update-popr-record.dto';
import { ReopenPoprRecordDto } from './dto/reopen-popr-record.dto';
import { PoprStatus } from './schemas/popr-record.schema';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { hasPermission } from '../common/utils/permission.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { UsersService } from '../users/users.service';
import { AssetsService } from '../assets/assets.service';

@Controller('popr-records')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class PoprController {
  constructor(
    private poprService: PoprService,
    private auditLogsService: AuditLogsService,
    private usersService: UsersService,
    private assetsService: AssetsService,
  ) {}

  private assertCanComplete(req: any, status?: PoprStatus) {
    if (
      status === PoprStatus.COMPLETED &&
      !hasPermission(req.user, 'supplies', 'approve')
    ) {
      throw new ForbiddenException(
        'ຕ້ອງມີສິດອະນຸມັດ (supplies:approve) ຈຶ່ງປິດສຳເລັດ POPR ໄດ້',
      );
    }
  }

  @Post()
  @RequirePermission('supplies', 'manage')
  async create(@Body() dto: CreatePoprRecordDto, @Req() req: any) {
    this.assertCanComplete(req, dto.status);
    const record = await this.poprService.create(dto, req.user.userId, req.ip);
    await this.auditLogsService.log(
      req.user.userId,
      'POPR_CREATED',
      'PoprRecord',
      record._id,
      undefined,
      record.toObject(),
      req.ip,
    );
    return record;
  }

  @Patch(':id/reopen')
  @RequirePermission('supplies', 'approve')
  async reopen(
    @Param('id') id: string,
    @Body() dto: ReopenPoprRecordDto,
    @Req() req: any,
  ) {
    return this.poprService.reopen(id, dto.reason, req.user.userId, req.ip);
  }

  @Patch(':id/close-po-short')
  @RequirePermission('supplies', 'approve')
  async closePoShort(
    @Param('id') id: string,
    @Body() dto: ReopenPoprRecordDto,
    @Req() req: any,
  ) {
    return this.poprService.closePoShort(
      id,
      dto.reason,
      req.user.userId,
      req.ip,
    );
  }

  @Get()
  @RequirePermission('supplies', 'manage')
  @ApiQuery({ name: 'status', required: false, enum: PoprStatus })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Search item, vendor, PO, S/N, asset tag, assignee',
  })
  findAll(@Query('status') status?: PoprStatus, @Query('q') q?: string) {
    return this.poprService.findAll({ status, q });
  }

  @Get('lookup/employee/:employeeCode')
  @RequirePermission('supplies', 'manage')
  lookupEmployee(@Param('employeeCode') employeeCode: string) {
    return this.usersService.lookupByEmployeeCode(employeeCode);
  }

  @Get('lookup/asset/:identifier')
  @RequirePermission('supplies', 'manage')
  lookupAsset(@Param('identifier') identifier: string) {
    return this.assetsService.lookupByTagOrId(identifier);
  }

  @Get(':id')
  @RequirePermission('supplies', 'manage')
  findOne(@Param('id') id: string) {
    return this.poprService.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('supplies', 'manage')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePoprRecordDto,
    @Req() req: any,
  ) {
    this.assertCanComplete(req, dto.status);
    const before = await this.poprService.findOne(id);
    const record = await this.poprService.update(
      id,
      dto,
      req.user.userId,
      req.ip,
    );
    await this.auditLogsService.log(
      req.user.userId,
      'POPR_UPDATED',
      'PoprRecord',
      id,
      before.toObject(),
      record.toObject(),
      req.ip,
    );
    return record;
  }

  @Patch(':id/complete')
  @RequirePermission('supplies', 'approve')
  async complete(@Param('id') id: string, @Req() req: any) {
    const before = await this.poprService.findOne(id);
    const record = await this.poprService.complete(id, req.user.userId, req.ip);
    await this.auditLogsService.log(
      req.user.userId,
      'POPR_COMPLETED',
      'PoprRecord',
      id,
      before.toObject(),
      record.toObject(),
      req.ip,
    );
    return record;
  }

  @Delete(':id')
  @RequirePermission('supplies', 'delete')
  async remove(@Param('id') id: string, @Req() req: any) {
    const before = await this.poprService.findOne(id);
    const result = await this.poprService.remove(id, req.user.userId, req.ip);
    await this.auditLogsService.log(
      req.user.userId,
      'POPR_DELETED',
      'PoprRecord',
      id,
      before.toObject(),
      undefined,
      req.ip,
    );
    return result;
  }
}
