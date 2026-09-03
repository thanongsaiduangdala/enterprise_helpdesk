import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { CannedResponsesService } from './canned-responses.service';
import { CreateCannedResponseDto } from './dto/create-canned-response.dto';
import { UpdateCannedResponseDto } from './dto/update-canned-response.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

// NOTE: gated under the existing 'tickets' permission — your permissions JSON has no
// dedicated 'canned-responses' module. Swap this for a new module name if you want
// canned-response management tracked separately from general ticket permissions.

@Controller('canned-responses')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class CannedResponsesController {
    constructor(private responsesService: CannedResponsesService) { }

    @Post()
    @RequirePermission('tickets', 'create')
    create(@Body() dto: CreateCannedResponseDto, @Req() req: any) {
        return this.responsesService.create(dto, req.user.userId);
    }

    @Get()
    @RequirePermission('tickets', 'read')
    @ApiQuery({ name: 'departmentId', required: false })
    findAll(@Query('departmentId') departmentId?: string) {
        return this.responsesService.findAll(departmentId);
    }

    @Get(':id')
    @RequirePermission('tickets', 'read')
    findOne(@Param('id') id: string) {
        return this.responsesService.findOne(id);
    }

    @Patch(':id')
    @RequirePermission('tickets', 'update')
    update(@Param('id') id: string, @Body() dto: UpdateCannedResponseDto) {
        return this.responsesService.update(id, dto);
    }

    @Delete(':id')
    @RequirePermission('tickets', 'delete')
    remove(@Param('id') id: string) {
        return this.responsesService.remove(id);
    }
}
