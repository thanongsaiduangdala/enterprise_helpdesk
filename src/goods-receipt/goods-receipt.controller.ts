import {
  Body,
  Controller,
  Get,
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

@Controller('goods-receipt')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
@RequirePermission('supplies', 'manage')
export class GoodsReceiptController {
  constructor(private service: GoodsReceiptService) {}

  @Post('restock')
  restock(@Body() dto: RestockDto, @Req() req: any) {
    return this.service.restock(dto, req.user.userId, req.ip);
  }

  @Post('new-item')
  newItem(@Body() dto: NewItemDto, @Req() req: any) {
    return this.service.newItem(dto, req.user.userId, req.ip);
  }

  @Get()
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'mode', required: false, enum: GoodsReceiptMode })
  findAll(@Query('q') q?: string, @Query('mode') mode?: GoodsReceiptMode) {
    const m =
      mode && Object.values(GoodsReceiptMode).includes(mode) ? mode : undefined;
    return this.service.findAll({ q, mode: m });
  }
}
