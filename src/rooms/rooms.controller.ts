import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    UploadedFile,
    UseInterceptors,
    UseGuards,
    BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiBody, ApiQuery } from '@nestjs/swagger';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { RoomStatus } from './schemas/room.schema';
import { SetRoomStatusDto } from './dto/set-room-status.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

@Controller('rooms')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class RoomsController {
    constructor(private roomsService: RoomsService) { }

    @Post()
    @RequirePermission('rooms', 'create')
    create(@Body() dto: CreateRoomDto) {
        return this.roomsService.create(dto);
    }

    @Post('bulk-import')
    @RequirePermission('rooms', 'create')
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
        return this.roomsService.bulkImport(file.buffer);
    }

    @Get()
    @RequirePermission('rooms', 'read')
    @ApiQuery({ name: 'branchId', required: false, description: 'Filter by branch — omit to get all rooms across every branch' })
    findAll(@Query('branchId') branchId?: string) {
        return this.roomsService.findAllWithLiveStatus(branchId);
    }


    @Get('utilization')
    @RequirePermission('rooms', 'read')
    utilization(@Query('from') from: string, @Query('to') to: string) {
        return this.roomsService.utilization(new Date(from), new Date(to));
    }

    @Get(':id')
    @RequirePermission('rooms', 'read')
    findOne(@Param('id') id: string) {
        return this.roomsService.findOneWithLiveStatus(id);
    }

    @Patch(':id')
    @RequirePermission('rooms', 'update')
    update(@Param('id') id: string, @Body() dto: UpdateRoomDto) {
        return this.roomsService.update(id, dto);
    }

    @Patch(':id/status')
    @RequirePermission('rooms', 'update')
    setStatus(@Param('id') id: string, @Body() dto: SetRoomStatusDto) {
        return this.roomsService.setStatus(id, dto.status);
    }

    @Delete(':id')
    @RequirePermission('rooms', 'delete')
    remove(@Param('id') id: string) {
        return this.roomsService.remove(id);
    }
}
