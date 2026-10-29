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
import { PurchaseRequestsService } from './purchase-requests.service';
import {
  ApprovePurchaseRequestDto,
  CreatePurchaseRequestDto,
  RejectPurchaseRequestDto,
} from './dto/purchase-request.dto';
import { PurchaseRequestStatus } from './schemas/purchase-request.schema';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { hasAnyPermission } from '../common/utils/permission.util';

@Controller('purchase-requests')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class PurchaseRequestsController {
  constructor(private service: PurchaseRequestsService) {}

  /** ຜູ້ມີສິດ approve/manage ເຫັນທຸກໃບ; ຄົນອື່ນເຫັນສະເພາະໃບຂອງຕົນ */
  private scopingUserId(req: any): string | undefined {
    return hasAnyPermission(req.user, 'supplies', ['approve', 'manage'])
      ? undefined
      : req.user.userId;
  }

  @Post()
  @RequirePermission('supplies', 'create')
  create(@Body() dto: CreatePurchaseRequestDto, @Req() req: any) {
    return this.service.create(dto, req.user.userId, req.ip);
  }

  @Get()
  @RequirePermission('supplies', 'read')
  @ApiQuery({ name: 'status', required: false, enum: PurchaseRequestStatus })
  @ApiQuery({ name: 'q', required: false })
  findAll(
    @Req() req: any,
    @Query('status') status?: PurchaseRequestStatus,
    @Query('q') q?: string,
  ) {
    return this.service.findAll(status, this.scopingUserId(req), q);
  }

  @Get('price-suggestion')
  @RequirePermission('supplies', 'create')
  @ApiQuery({ name: 'catalogItemId', required: true })
  suggestPrice(@Query('catalogItemId') catalogItemId: string) {
    return this.service.suggestPrice(catalogItemId);
  }

  @Get(':id')
  @RequirePermission('supplies', 'read')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.service.findOne(id, this.scopingUserId(req));
  }

  @Patch(':id/approve')
  @RequirePermission('supplies', 'approve')
  approve(
    @Param('id') id: string,
    @Body() dto: ApprovePurchaseRequestDto,
    @Req() req: any,
  ) {
    return this.service.approve(
      id,
      req.user.userId,
      req.ip,
      dto?.confirmLinkedApproval === true,
    );
  }

  @Patch(':id/reject')
  @RequirePermission('supplies', 'approve')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectPurchaseRequestDto,
    @Req() req: any,
  ) {
    return this.service.reject(id, req.user.userId, dto.reason, req.ip);
  }

  @Patch(':id/cancel')
  @RequirePermission('supplies', 'create')
  cancel(@Param('id') id: string, @Req() req: any) {
    return this.service.cancel(id, req.user.userId, req.ip);
  }
}
