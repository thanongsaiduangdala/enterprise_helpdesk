import {
    Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { SlaPoliciesService } from './sla-policies.service';
import { CreateSlaPolicyDto } from './dto/create-sla-policy.dto';
import { UpdateSlaPolicyDto } from './dto/update-sla-policy.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

@Controller('sla-policies')
@ApiBearerAuth()
export class SlaPoliciesController {
    constructor(private slaPoliciesService: SlaPoliciesService) { }

    @Get('ticket-type/:ticketTypeId/available-priorities')
    @UseGuards(JwtAuthGuard)
    findAvailablePriorities(@Param('ticketTypeId') ticketTypeId: string) {
        return this.slaPoliciesService.findAvailablePriorities(ticketTypeId);
    }

    @Post()
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission('sla', 'create')
    create(@Body() dto: CreateSlaPolicyDto, @Req() req: any) {
        return this.slaPoliciesService.create(dto, req.user.userId, req.ip);
    }

    @Get()
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission('sla', 'read')
    findAll() {
        return this.slaPoliciesService.findAll();
    }

    @Get(':id')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission('sla', 'read')
    findOne(@Param('id') id: string) {
        return this.slaPoliciesService.findOne(id);
    }

    @Patch(':id')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission('sla', 'update')
    update(@Param('id') id: string, @Body() dto: UpdateSlaPolicyDto, @Req() req: any) {
        return this.slaPoliciesService.update(id, dto, req.user.userId, req.ip);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission('sla', 'delete')
    remove(@Param('id') id: string, @Req() req: any) {
        return this.slaPoliciesService.remove(id, req.user.userId, req.ip);
    }
}