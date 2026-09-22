import {
    Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards, UploadedFile, UseInterceptors, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
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
    create(@Body() dto: CreateBranchDto, @Req() req: any) {
        return this.branchesService.create(dto, req.user.userId, req.ip);
    }

    @Post('bulk-import')
    @RequirePermission('branches', 'create')
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
        return this.branchesService.bulkImport(file.buffer, req.user.userId, req.ip);
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
    update(@Param('id') id: string, @Body() dto: UpdateBranchDto, @Req() req: any) {
        return this.branchesService.update(id, dto, req.user.userId, req.ip);
    }

    @Delete(':id')
    @RequirePermission('branches', 'delete')
    remove(@Param('id') id: string, @Req() req: any) {
        return this.branchesService.remove(id, req.user.userId, req.ip);
    }
}