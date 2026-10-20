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
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiQuery } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { BadRequestException } from '@nestjs/common';
import { SupplyCatalogService } from './supply-catalog.service';
import { CreateSupplyCatalogItemDto } from './dto/create-supply-catalog-item.dto';
import { UpdateSupplyCatalogItemDto } from './dto/update-supply-catalog-item.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { CatalogItemType } from './schemas/supply-catalog-item.schema';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Controller('supply-catalog')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class SupplyCatalogController {
  constructor(
    private catalogService: SupplyCatalogService,
    private auditLogsService: AuditLogsService,
  ) {}

  @Post()
  @RequirePermission('supplies', 'manage')
  async create(@Body() dto: CreateSupplyCatalogItemDto, @Req() req: any) {
    const created = await this.catalogService.create(dto);
    await this.auditLogsService.log(
      req.user.userId,
      'CATALOG_CREATED',
      'SupplyCatalogItem',
      created._id,
      undefined,
      created.toObject(),
      req.ip,
    );
    return created;
  }

  @Get()
  @RequirePermission('supplies', 'read')
  @ApiQuery({
    name: 'lowStockOnly',
    required: false,
    type: Boolean,
    description: 'true = only items at/below their low-stock threshold',
  })
  findAll(@Query('lowStockOnly') lowStockOnly?: string) {
    return this.catalogService.findAll(lowStockOnly === 'true');
  }

  @Post('bulk-import')
  @RequirePermission('supplies', 'import')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  async bulkImport(@UploadedFile() file: Express.Multer.File, @Req() req: any) {
    if (!file) {
      throw new BadRequestException(
        'No file uploaded — expected a CSV file under field name "file"',
      );
    }
    const result = await this.catalogService.bulkImport(file.buffer);
    await this.auditLogsService.log(
      req.user.userId,
      'CATALOG_BULK_IMPORTED',
      'SupplyCatalogItem',
      'bulk',
      undefined,
      { total: result.total, created: result.created, failed: result.failed },
      req.ip,
    );
    return result;
  }

  @Post('recalculate-stock')
  @RequirePermission('supplies', 'update')
  async recalculateStock(@Req() req: any) {
    const result = await this.catalogService.recalculateAssetStock();
    for (const c of result.changes) {
      await this.auditLogsService.log(
        req.user.userId,
        'CATALOG_STOCK_RECALCULATED',
        'SupplyCatalogItem',
        c._id,
        { stockQty: c.before },
        { stockQty: c.after, reason: 'recalculated from AVAILABLE assets' },
        req.ip,
      );
    }
    return result;
  }

  @Get(':id')
  @RequirePermission('supplies', 'read')
  findOne(@Param('id') id: string) {
    return this.catalogService.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('supplies', 'update')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSupplyCatalogItemDto,
    @Req() req: any,
  ) {
    const before = (await this.catalogService.findOne(id)).toObject();
    const after = await this.catalogService.update(id, dto);
    await this.auditLogsService.log(
      req.user.userId,
      'CATALOG_UPDATED',
      'SupplyCatalogItem',
      id,
      before,
      after.toObject(),
      req.ip,
    );
    return after;
  }

  @Patch(':id/adjust-stock')
  @RequirePermission('supplies', 'update')
  async adjustStock(
    @Param('id') id: string,
    @Body() dto: AdjustStockDto,
    @Req() req: any,
  ) {
    const before = (await this.catalogService.findOne(id)).toObject();
    // ຊັບສິນ: ສະຕ໊ອກນັບຈາກຈຳນວນຊັບສິນວ່າງອັດຕະໂນມັດ — ປ່ຽນແບບມືຈະຖືກ syncStock/Recalculate ຂຽນທັບ
    // (ແລ້ວເຮັດໃຫ້ strict ຕອນມອບປະຕິເສດຜິດໆ) → ໃຫ້ແກ້ດ້ວຍ "ຄຳນວນສະຕ໊ອກໃໝ່" ແທນ
    if (before.itemType === CatalogItemType.ASSET) {
      throw new BadRequestException(
        `ລາຍການ "${before.name}" ເປັນຊັບສິນ — ສະຕ໊ອກນັບຈາກຊັບສິນວ່າງອັດຕະໂນມັດ ປ່ຽນດ້ວຍມືບໍ່ໄດ້ (ກົດ "ຄຳນວນສະຕ໊ອກໃໝ່" ແທນ)`,
      );
    }
    const after = await this.catalogService.adjustStock(id, dto.delta);
    await this.auditLogsService.log(
      req.user.userId,
      'CATALOG_STOCK_ADJUSTED',
      'SupplyCatalogItem',
      id,
      { stockQty: before.stockQty },
      {
        stockQty: after.stockQty,
        delta: dto.delta,
        reason: dto.reason?.trim() || 'manual adjustment',
      },
      req.ip,
    );
    return after;
  }

  @Delete(':id')
  @RequirePermission('supplies', 'delete')
  async remove(@Param('id') id: string, @Req() req: any) {
    const before = (await this.catalogService.findOne(id)).toObject();
    const result = await this.catalogService.remove(id);
    await this.auditLogsService.log(
      req.user.userId,
      'CATALOG_DISABLED',
      'SupplyCatalogItem',
      id,
      before,
      { isActive: false },
      req.ip,
    );
    return result;
  }
}
