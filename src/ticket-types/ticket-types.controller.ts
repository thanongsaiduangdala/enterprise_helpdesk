import {
    Body, Controller, Delete, Get, Param, Patch, Post, UploadedFile, UseInterceptors, UseGuards, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { TicketTypesService } from './ticket-types.service';
import { CreateTicketTypeDto } from './dto/create-ticket-type.dto';
import { UpdateTicketTypeDto } from './dto/update-ticket-type.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

@Controller('ticket-types')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class TicketTypesController {
    constructor(private ticketTypesService: TicketTypesService) { }

    @Post()
    @RequirePermission('ticket-types', 'create')
    create(@Body() dto: CreateTicketTypeDto) {
        return this.ticketTypesService.create(dto);
    }

    @Post('bulk-import')
    @RequirePermission('ticket-types', 'create')
    @UseInterceptors(FileInterceptor('file'))
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: { file: { type: 'string', format: 'binary' } },
        },
    })
    bulkImport(@UploadedFile() file: Express.Multer.File) {
        if (!file) {
            throw new BadRequestException('No file uploaded — expected a CSV file under field name "file"');
        }
        return this.ticketTypesService.bulkImport(file.buffer);
    }

    @Get()
    @RequirePermission('ticket-types', 'read')
    findAll() {
        return this.ticketTypesService.findAll();
    }

    @Get(':id')
    @RequirePermission('ticket-types', 'read')
    findOne(@Param('id') id: string) {
        return this.ticketTypesService.findOne(id);
    }

    @Patch(':id')
    @RequirePermission('ticket-types', 'update')
    update(@Param('id') id: string, @Body() dto: UpdateTicketTypeDto) {
        return this.ticketTypesService.update(id, dto);
    }

    @Delete(':id')
    @RequirePermission('ticket-types', 'delete')
    remove(@Param('id') id: string) {
        return this.ticketTypesService.remove(id);
    }
}