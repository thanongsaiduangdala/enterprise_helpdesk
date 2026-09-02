import {
    Body,
    Controller,
    Get,
    Param,
    Patch,
    Post,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SupplyRequestsService } from './supply-requests.service';
import { CreateSupplyRequestDto } from './dto/create-supply-request.dto';
import { RejectSupplyRequestDto } from './dto/reject-supply-request.dto';
import { BulkFulfillDto } from './dto/bulk-fulfill.dto';
import { SupplyRequestStatus } from './schemas/supply-request.schema';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

@Controller('supply-requests')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class SupplyRequestsController {
    constructor(private requestsService: SupplyRequestsService) { }

    // Any employee can submit a request.
    @Post()
    @RequirePermission('supplies', 'create')
    create(@Body() dto: CreateSupplyRequestDto, @Req() req: any) {
        return this.requestsService.create(dto, req.user.userId);
    }

    // "My requests" history.
    @Get('my')
    @RequirePermission('supplies', 'read')
    findMine(@Req() req: any) {
        return this.requestsService.findMine(req.user.userId);
    }

    // Manager/admin queue — e.g. ?status=REQUESTED to see what's pending approval.
    @Get()
    @RequirePermission('supplies', 'read')
    @ApiQuery({ name: 'status', required: false, enum: SupplyRequestStatus })
    findAll(@Query('status') status?: SupplyRequestStatus) {
        return this.requestsService.findAll(status);
    }

    @Get(':id')
    @RequirePermission('supplies', 'read')
    findOne(@Param('id') id: string) {
        return this.requestsService.findOne(id);
    }

    // Dept Manager approval step.
    @Patch(':id/approve')
    @RequirePermission('supplies', 'approve')
    approve(@Param('id') id: string, @Req() req: any) {
        return this.requestsService.approve(id, req.user.userId);
    }

    @Patch(':id/reject')
    @RequirePermission('supplies', 'approve')
    reject(@Param('id') id: string, @Body() dto: RejectSupplyRequestDto, @Req() req: any) {
        return this.requestsService.reject(id, req.user.userId, dto.reason);
    }

    // Procurement/Admin fulfillment step — deducts catalog stock, see service for details.
    @Patch(':id/fulfill')
    @RequirePermission('supplies', 'fulfill')
    fulfill(@Param('id') id: string, @Req() req: any) {
        return this.requestsService.fulfill(id, req.user.userId);
    }

    @Post('bulk-fulfill')
    @RequirePermission('supplies', 'fulfill')
    bulkFulfill(@Body() dto: BulkFulfillDto, @Req() req: any) {
        return this.requestsService.bulkFulfill(dto.ids, req.user.userId);
    }
}
