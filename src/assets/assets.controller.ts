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
import { AssetsService } from './assets.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { AssignAssetDto } from './dto/assign-asset.dto';
import { ReturnAssetDto } from './dto/return-asset.dto';
import { SetAssetStatusDto } from './dto/set-asset-status.dto';
import { AssetStatus } from './schemas/asset.schema';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

@Controller('assets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class AssetsController {
    constructor(private assetsService: AssetsService) { }

    @Post()
    @RequirePermission('assets', 'create')
    create(@Body() dto: CreateAssetDto) {
        return this.assetsService.create(dto);
    }

    @Get()
    @RequirePermission('assets', 'read')
    @ApiQuery({ name: 'branchId', required: false })
    @ApiQuery({ name: 'status', required: false, enum: AssetStatus })
    @ApiQuery({ name: 'assigneeId', required: false })
    findAll(
        @Query('branchId') branchId?: string,
        @Query('status') status?: AssetStatus,
        @Query('assigneeId') assigneeId?: string,
    ) {
        return this.assetsService.findAll({ branchId, status, assigneeId });
    }

    // Placed before ':id' so it isn't swallowed by that route.
    @Get('overdue')
    @RequirePermission('assets', 'read')
    findOverdue() {
        return this.assetsService.findOverdueReturns();
    }

    @Get(':id')
    @RequirePermission('assets', 'read')
    findOne(@Param('id') id: string) {
        return this.assetsService.findOne(id);
    }

    @Patch(':id')
    @RequirePermission('assets', 'update')
    update(@Param('id') id: string, @Body() dto: UpdateAssetDto) {
        return this.assetsService.update(id, dto);
    }

    @Patch(':id/assign')
    @RequirePermission('assets', 'assign')
    assign(@Param('id') id: string, @Body() dto: AssignAssetDto) {
        return this.assetsService.assign(id, dto);
    }

    @Patch(':id/return')
    @RequirePermission('assets', 'assign')
    returnAsset(@Param('id') id: string, @Body() dto: ReturnAssetDto) {
        return this.assetsService.returnAsset(id, dto);
    }

    @Patch(':id/status')
    @RequirePermission('assets', 'update')
    setStatus(@Param('id') id: string, @Body() dto: SetAssetStatusDto) {
        return this.assetsService.setStatus(id, dto.status);
    }

    @Delete(':id')
    @RequirePermission('assets', 'delete')
    remove(@Param('id') id: string) {
        return this.assetsService.remove(id);
    }
}
