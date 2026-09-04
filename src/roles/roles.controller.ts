import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

@Controller('roles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class RolesController {
    constructor(private rolesService: RolesService) { }

    @Post()
    @RequirePermission('roles', 'create')
    create(@Body() dto: CreateRoleDto, @Req() req: any) {
        return this.rolesService.create(dto, req.user.userId, req.ip);
    }

    @Get()
    @RequirePermission('roles', 'read')
    findAll() {
        return this.rolesService.findAll();
    }

    @Get(':id')
    @RequirePermission('roles', 'read')
    findOne(@Param('id') id: string) {
        return this.rolesService.findOne(id);
    }

    @Patch(':id')
    @RequirePermission('roles', 'update')
    update(@Param('id') id: string, @Body() dto: UpdateRoleDto, @Req() req: any) {
        return this.rolesService.update(id, dto, req.user.userId, req.ip);
    }

    @Delete(':id')
    @RequirePermission('roles', 'delete')
    remove(@Param('id') id: string, @Req() req: any) {
        return this.rolesService.remove(id, req.user.userId, req.ip);
    }
}