import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
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

    @Post('bulk-import')
    @RequirePermission('supplies', 'create')
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
            throw new BadRequestException('No file uploaded — expected a CSV file under field name "file"');
        }
        return this.catalogService.bulkImport(file.buffer);
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



    @Patch(':id/adjust-stock')
    @RequirePermission('supplies', 'update')
    adjustStock(@Param('id') id: string, @Body() dto: AdjustStockDto) {
        return this.catalogService.adjustStock(id, dto.delta);
    }





    @Delete(':id')
    @RequirePermission('supplies', 'delete')
    remove(@Param('id') id: string) {
        return this.catalogService.remove(id);
    }
}
