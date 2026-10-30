import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SupplyRequestsService } from './supply-requests.service';
import { CreateSupplyRequestDto } from './dto/create-supply-request.dto';
import { RejectSupplyRequestDto } from './dto/reject-supply-request.dto';
import { BulkFulfillDto } from './dto/bulk-fulfill.dto';
import { ReceiveSupplyRequestDto } from './dto/receive-supply-request.dto';
import { SetSupplyRequestDelegateDto } from './dto/set-supply-request-delegate.dto';
import { SupplyRequestStatus } from './schemas/supply-request.schema';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { hasAnyPermission } from '../common/utils/permission.util';

@Controller('supply-requests')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class SupplyRequestsController {
  constructor(private requestsService: SupplyRequestsService) {}

  /**
   * Undefined => caller can see every request (approve/fulfill/manage).
   * userId   => caller only sees requests they raised.
   */
  private scopingUserId(req: any): string | undefined {
    const elevated = hasAnyPermission(req.user, 'supplies', [
      'approve',
      'fulfill',
      'manage',
    ]);
    return elevated ? undefined : req.user.userId;
  }

  @Post()
  @RequirePermission('supplies', 'create')
  create(@Body() dto: CreateSupplyRequestDto, @Req() req: any) {
    return this.requestsService.create(dto, req.user.userId, req.ip);
  }

  /** Own requests + requests in departments where the caller is a registered manager. */
  @Get('my')
  @RequirePermission('supplies', 'read')
  findMine(@Req() req: any) {
    return this.requestsService.findMine(req.user.userId);
  }

  /** Departments the current requester may select for a department supply request. */
  @Get('requestable-departments')
  @RequirePermission('supplies', 'create')
  findRequestableDepartments(@Req() req: any) {
    return this.requestsService.findRequestableDepartments(req.user.userId);
  }

  /** ຄົ້ນຫາຄົນທີ່ເລືອກເປັນຜູ້ຮັບຜິດຊອບ ຕອນສ້າງໃບຂໍໃນນາມແຜນກ (ສະມາຊິກ/ຫົວໜ້າຂອງແຜນກນັ້ນ) */
  @Get('custodian-candidates')
  @RequirePermission('supplies', 'create')
  @ApiQuery({ name: 'departmentId', required: true })
  @ApiQuery({ name: 'q', required: false })
  findCustodianCandidates(
    @Query('departmentId') departmentId: string,
    @Query('q') q: string | undefined,
    @Req() req: any,
  ) {
    return this.requestsService.findCustodianCandidates(
      departmentId,
      q,
      req.user.userId,
    );
  }

  @Get()
  @RequirePermission('supplies', 'read')
  @ApiQuery({ name: 'status', required: false, enum: SupplyRequestStatus })
  findAll(
    @Query('status') status: SupplyRequestStatus | undefined,
    @Req() req: any,
  ) {
    return this.requestsService.findAll(status, this.scopingUserId(req));
  }

  /** ຄິວຂັ້ນທີ 1: ຄຳຂໍສ່ວນບຸກຄົນທີ່ລໍຖ້າຫົວໜ້າພະແນກ (403 ຖ້າບໍ່ແມ່ນຫົວໜ້າ/ຜູ້ອະນຸມັດ) */
  @Get('manager-queue')
  @RequirePermission('supplies', 'read')
  managerQueue(@Req() req: any) {
    return this.requestsService.findManagerQueue(req.user);
  }

  /** ປະຫວັດຂັ້ນທີ 1: ໃບທີ່ຫົວໜ້າຕັດສິນແລ້ວ (ສິດດຽວກັບ manager-queue) — ຕ້ອງຢູ່ກ່ອນ :id */
  @Get('manager-history')
  @RequirePermission('supplies', 'read')
  managerHistory(@Query('limit') limit: string | undefined, @Req() req: any) {
    return this.requestsService.findManagerHistory(
      req.user,
      limit ? Number(limit) : undefined,
    );
  }

  /** ປະຫວັດຝັ່ງຝ່າຍສາງ: ໃບທີ່ອອກຈາກຄິວລໍຖ້າອະນຸມັດແລ້ວ — ຕ້ອງຢູ່ກ່ອນ :id */
  @Get('history')
  @RequirePermission('supplies', 'read')
  history(@Query('limit') limit: string | undefined, @Req() req: any) {
    return this.requestsService.findWarehouseHistory(
      this.scopingUserId(req),
      limit ? Number(limit) : undefined,
    );
  }

  /** ໃບຮັບເຄື່ອງ: ຂໍ້ມູນໃບຂໍ + ລາຍການທີ່ຕ້ອງສະແກນ Asset Tag + ສິດຢືນຢັນຂອງຜູ້ເປີດ */
  @Get(':id/receipt')
  @RequirePermission('supplies', 'read')
  getReceipt(@Param('id') id: string, @Req() req: any) {
    return this.requestsService.getReceipt(id, req.user);
  }

  /** ຄົ້ນຫາ/ກັ່ນຕອງຄົນທີ່ເລືອກເປັນຜູ້ຮັບແທນໄດ້ — ສະເພາະຜູ້ມີສິດກຳນົດຜູ້ຮັບແທນຂອງໃບນີ້ */
  @Get(':id/delegate-candidates')
  @RequirePermission('supplies', 'read')
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'departmentId', required: false })
  delegateCandidates(
    @Param('id') id: string,
    @Query('q') q: string | undefined,
    @Query('departmentId') departmentId: string | undefined,
    @Req() req: any,
  ) {
    return this.requestsService.findDelegateCandidates(
      id,
      { q, departmentId },
      req.user,
    );
  }

  @Get(':id')
  @RequirePermission('supplies', 'read')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.requestsService.findOne(id, this.scopingUserId(req));
  }

  /** ຫົວໜ້າພະແນກອະນຸມັດຂັ້ນທີ 1 — service ກວດວ່າເປັນຫົວໜ້າພະແນກຂອງຜູ້ຂໍ (ຫຼື supplies:approve ແທນ) */
  @Patch(':id/manager-approve')
  @RequirePermission('supplies', 'read')
  managerApprove(@Param('id') id: string, @Req() req: any) {
    return this.requestsService.managerApprove(id, req.user, req.ip);
  }

  @Patch(':id/manager-reject')
  @RequirePermission('supplies', 'read')
  managerReject(
    @Param('id') id: string,
    @Body() dto: RejectSupplyRequestDto,
    @Req() req: any,
  ) {
    return this.requestsService.managerReject(id, req.user, dto.reason, req.ip);
  }

  @Patch(':id/approve')
  @RequirePermission('supplies', 'approve')
  approve(@Param('id') id: string, @Req() req: any) {
    return this.requestsService.approve(id, req.user.userId, req.ip);
  }

  @Patch(':id/reject')
  @RequirePermission('supplies', 'approve')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectSupplyRequestDto,
    @Req() req: any,
  ) {
    return this.requestsService.reject(id, req.user.userId, dto.reason, req.ip);
  }

  @Patch(':id/fulfill')
  @RequirePermission('supplies', 'fulfill')
  fulfill(@Param('id') id: string, @Req() req: any) {
    return this.requestsService.fulfill(id, req.user.userId, req.ip);
  }

  /**
   * ຜູ້ຂໍ (ຫຼືຜູ້ຮັບຜິດຊອບ/ຫົວໜ້າແຜນກ) ກຳນົດ/ປ່ຽນ/ລຶບ ຜູ້ຮັບແທນ (1 ຄົນ) — service ກວດສິດ ແລະສະຖານະ
   */
  @Patch(':id/delegate')
  @RequirePermission('supplies', 'read')
  setDelegate(
    @Param('id') id: string,
    @Body() dto: SetSupplyRequestDelegateDto,
    @Req() req: any,
  ) {
    return this.requestsService.setDelegate(id, dto, req.user, req.ip);
  }

  // ຜູ້ຂໍ (supplies.read) ຢືນຢັນຮັບເອງໄດ້ — service ກວດວ່າເປັນຜູ້ຂໍ ຫຼື ມີສິດ supplies.fulfill
  @Patch(':id/receive')
  @RequirePermission('supplies', 'read')
  receive(
    @Param('id') id: string,
    @Body() dto: ReceiveSupplyRequestDto,
    @Req() req: any,
  ) {
    return this.requestsService.receive(id, dto, req.user, req.ip);
  }

  @Post('bulk-fulfill')
  @RequirePermission('supplies', 'fulfill')
  bulkFulfill(@Body() dto: BulkFulfillDto, @Req() req: any) {
    return this.requestsService.bulkFulfill(dto.ids, req.user.userId, req.ip);
  }
}
