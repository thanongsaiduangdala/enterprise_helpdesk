import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { SetUserActiveDto } from './dto/set-user-active.dto';


@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class UsersController {
    constructor(private usersService: UsersService) { }

    @Post()
    @RequirePermission('users', 'create')
    create(@Body() dto: CreateUserDto, @Req() req: any) {
        return this.usersService.create(dto, req.user.userId, req.ip);
    }

    @Patch(':id/status')
    @RequirePermission('users', 'update')
    setActive(@Param('id') id: string, @Body() dto: SetUserActiveDto, @Req() req: any) {
        return this.usersService.setActive(id, dto.isActive, req.user.userId, req.ip);
    }

    @Get()
    @RequirePermission('users', 'read')
    @ApiQuery({ name: 'branchId', required: false })
    @ApiQuery({ name: 'departmentId', required: false })
    @ApiQuery({ name: 'role', required: false, description: 'A roles._id' })
    findAll(
        @Query('branchId') branchId?: string,
        @Query('departmentId') departmentId?: string,
        @Query('role') role?: string,
    ) {
        return this.usersService.findAll({ branchId, departmentId, role });
    }

    @Get(':id')
    @RequirePermission('users', 'read')
    findOne(@Param('id') id: string) {
        return this.usersService.findOne(id);
    }

    @Patch(':id')
    @RequirePermission('users', 'update')
    update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Req() req: any) {
        return this.usersService.update(id, dto, req.user.userId, req.ip);
    }

    @Delete(':id')
    @RequirePermission('users', 'delete')
    remove(@Param('id') id: string, @Req() req: any) {
        return this.usersService.remove(id, req.user.userId, req.ip);
    }
}