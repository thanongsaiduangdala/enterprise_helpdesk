import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SupplyCatalogService } from './supply-catalog.service';
import { CreateSupplyCatalogItemDto } from './dto/create-supply-catalog-item.dto';
import { UpdateSupplyCatalogItemDto } from './dto/update-supply-catalog-item.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

@Controller('supply-catalog')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class SupplyCatalogController {
    constructor(private catalogService: SupplyCatalogService) { }

    @Post()
    @RequirePermission('supplies', 'create')
    create(@Body() dto: CreateSupplyCatalogItemDto) {
        return this.catalogService.create(dto);
    }

    @Get()
    @RequirePermission('supplies', 'read')
    @ApiQuery({ name: 'lowStockOnly', required: false, type: Boolean, description: 'true = only items at/below their low-stock threshold' })
    findAll(@Query('lowStockOnly') lowStockOnly?: string) {
        return this.catalogService.findAll(lowStockOnly === 'true');
    }

    @Get(':id')
    @RequirePermission('supplies', 'read')
    findOne(@Param('id') id: string) {
        return this.catalogService.findOne(id);
    }

    @Patch(':id')
    @RequirePermission('supplies', 'update')
    update(@Param('id') id: string, @Body() dto: UpdateSupplyCatalogItemDto) {
        return this.catalogService.update(id, dto);
    }

    // Manual admin stock correction/restock — NOT used by the request-fulfillment flow,
    // which calls catalogService.adjustStock() directly from SupplyRequestsService.
    @Patch(':id/adjust-stock')
    @RequirePermission('supplies', 'update')
    adjustStock(@Param('id') id: string, @Body() dto: AdjustStockDto) {
        return this.catalogService.adjustStock(id, dto.delta);
    }

    // NOTE: your current permissions JSON for the 'supplies' module only lists
    // create/read/update/approve/fulfill — no 'delete'. This will 403 until you add
    // 'delete' to that permission set, or you may prefer items are only ever
    // deactivated (isActive: false via PATCH) rather than hard-deleted.
    @Delete(':id')
    @RequirePermission('supplies', 'delete')
    remove(@Param('id') id: string) {
        return this.catalogService.remove(id);
    }
}
