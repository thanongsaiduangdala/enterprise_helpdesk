import {
    Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards, UploadedFile, UseInterceptors, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
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
    create(@Body() dto: CreateDepartmentDto, @Req() req: any) {
        return this.departmentsService.create(dto, req.user.userId, req.ip);
    }

    @Post('bulk-import')
    @RequirePermission('departments', 'create')
    @UseInterceptors(FileInterceptor('file'))
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: { file: { type: 'string', format: 'binary' } },
        },
    })
    bulkImport(@UploadedFile() file: Express.Multer.File, @Req() req: any) {
        if (!file) {
            throw new BadRequestException('No file uploaded — expected a CSV file under field name "file"');
        }
        return this.departmentsService.bulkImport(file.buffer, req.user.userId, req.ip);
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
    update(@Param('id') id: string, @Body() dto: UpdateDepartmentDto, @Req() req: any) {
        return this.departmentsService.update(id, dto, req.user.userId, req.ip);
    }

    @Delete(':id')
    @RequirePermission('departments', 'delete')
    remove(@Param('id') id: string, @Req() req: any) {
        return this.departmentsService.remove(id, req.user.userId, req.ip);
    }
}