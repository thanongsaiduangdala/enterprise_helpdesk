import {
    Body, Controller, Delete, Get, Param, Patch, Post, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

@Controller('branches')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class BranchesController {
    constructor(private branchesService: BranchesService) { }

    @Post()
    @RequirePermission('branches', 'create')
    create(@Body() dto: CreateBranchDto) {
        return this.branchesService.create(dto);
    }

    @Get()
    @RequirePermission('branches', 'read')
    findAll() {
        return this.branchesService.findAll();
    }

    @Get(':id')
    @RequirePermission('branches', 'read')
    findOne(@Param('id') id: string) {
        return this.branchesService.findOne(id);
    }

    @Patch(':id')
    @RequirePermission('branches', 'update')
    update(@Param('id') id: string, @Body() dto: UpdateBranchDto) {
        return this.branchesService.update(id, dto);
    }

    @Delete(':id')
    @RequirePermission('branches', 'delete')
    remove(@Param('id') id: string) {
        return this.branchesService.remove(id);
    }
}