import {
    Body, Controller, Delete, Get, Param, Patch, Post, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

@Controller('departments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class DepartmentsController {
    constructor(private departmentsService: DepartmentsService) { }

    @Post()
    @RequirePermission('departments', 'create')
    create(@Body() dto: CreateDepartmentDto) {
        return this.departmentsService.create(dto);
    }

    @Get()
    @RequirePermission('departments', 'read')
    findAll() {
        return this.departmentsService.findAll();
    }

    @Get(':id')
    @RequirePermission('departments', 'read')
    findOne(@Param('id') id: string) {
        return this.departmentsService.findOne(id);
    }

    @Patch(':id')
    @RequirePermission('departments', 'update')
    update(@Param('id') id: string, @Body() dto: UpdateDepartmentDto) {
        return this.departmentsService.update(id, dto);
    }

    @Delete(':id')
    @RequirePermission('departments', 'delete')
    remove(@Param('id') id: string) {
        return this.departmentsService.remove(id);
    }
}