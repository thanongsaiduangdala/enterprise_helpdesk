import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { GoodsReceiptService } from './goods-receipt.service';
import { NewItemDto, RestockDto } from './dto/goods-receipt.dto';
import { GoodsReceiptMode } from './schemas/goods-receipt.schema';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { hasPermission } from '../common/utils/permission.util';

@Controller('goods-receipt')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
@RequirePermission('supplies', 'manage')
export class GoodsReceiptController {
  constructor(private service: GoodsReceiptService) {}

  /** ຜູ້ມີສິດພິເສດ (supplies:approve) ຮັບເຄື່ອງໂດຍບໍ່ມີໃບສະເໜີໄດ້ ຖ້າໃສ່ເຫດຜົນ */
  private canException(req: any): boolean {
    return hasPermission(req.user, 'supplies', 'approve');
  }

  @Post('restock')
  restock(@Body() dto: RestockDto, @Req() req: any) {
    return this.service.restock(dto, req.user.userId, req.ip, this.canException(req));
  }

  @Post('new-item')
  newItem(@Body() dto: NewItemDto, @Req() req: any) {
    return this.service.newItem(dto, req.user.userId, req.ip, this.canException(req));
  }

  @Get('summary')
  @RequirePermission('supplies', 'read')
  summary() {
    return this.service.summary();
  }

  @Get(':id')
  @RequirePermission('supplies', 'read')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get()
  @RequirePermission('supplies', 'read')
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'mode', required: false, enum: GoodsReceiptMode })
  @ApiQuery({ name: 'catalogItemId', required: false })
  findAll(
    @Query('q') q?: string,
    @Query('mode') mode?: GoodsReceiptMode,
    @Query('catalogItemId') catalogItemId?: string,
  ) {
    const m =
      mode && Object.values(GoodsReceiptMode).includes(mode) ? mode : undefined;
    return this.service.findAll({ q, mode: m, catalogItemId });
  }
}
