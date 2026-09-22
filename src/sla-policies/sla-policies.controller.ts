import {
    Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards, UploadedFile, UseInterceptors, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
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

    @Post('bulk-import')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission('sla', 'create')
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
        return this.slaPoliciesService.bulkImport(file.buffer, req.user.userId, req.ip);
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