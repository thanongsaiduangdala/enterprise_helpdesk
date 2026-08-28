import {
    Body, Controller, Delete, Get, Param, Patch, Post, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { SlaPoliciesService } from './sla-policies.service';
import { CreateSlaPolicyDto } from './dto/create-sla-policy.dto';
import { UpdateSlaPolicyDto } from './dto/update-sla-policy.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

@Controller('sla-policies')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class SlaPoliciesController {
    constructor(private slaPoliciesService: SlaPoliciesService) { }

    @Post()
    @RequirePermission('sla', 'create')
    create(@Body() dto: CreateSlaPolicyDto) {
        return this.slaPoliciesService.create(dto);
    }

    @Get()
    @RequirePermission('sla', 'read')
    findAll() {
        return this.slaPoliciesService.findAll();
    }

    @Get(':id')
    @RequirePermission('sla', 'read')
    findOne(@Param('id') id: string) {
        return this.slaPoliciesService.findOne(id);
    }

    @Patch(':id')
    @RequirePermission('sla', 'update')
    update(@Param('id') id: string, @Body() dto: UpdateSlaPolicyDto) {
        return this.slaPoliciesService.update(id, dto);
    }

    @Delete(':id')
    @RequirePermission('sla', 'delete')
    remove(@Param('id') id: string) {
        return this.slaPoliciesService.remove(id);
    }
}