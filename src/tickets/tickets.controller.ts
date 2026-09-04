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
import { TicketsService } from './tickets.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { AssignTicketDto } from './dto/assign-ticket.dto';
import { ChangeTicketStatusDto } from './dto/change-ticket-status.dto';
import { SubmitTicketFeedbackDto } from './dto/submit-ticket-feedback.dto';
import { TicketStatus } from './schemas/ticket.schema';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

@Controller('tickets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class TicketsController {
    constructor(private ticketsService: TicketsService) { }

    // Any employee can raise a ticket.
    @Post()
    @RequirePermission('tickets', 'create')
    create(@Body() dto: CreateTicketDto, @Req() req: any) {
        return this.ticketsService.create(dto, req.user.userId);
    }

    // Personal "my tickets" dashboard widget. Placed before ':id' so it isn't swallowed
    // by that route.
    @Get('my')
    @RequirePermission('tickets', 'read')
    findMine(@Req() req: any) {
        return this.ticketsService.findMine(req.user.userId);
    }

    // Agent's personal queue.
    @Get('assigned-to-me')
    @RequirePermission('tickets', 'read')
    findAssignedToMe(@Req() req: any) {
        return this.ticketsService.findAssignedToMe(req.user.userId);
    }

    // Admin/manager filtered view — e.g. ?departmentId=DX001&status=OPEN
    @Get()
    @RequirePermission('tickets', 'read')
    @ApiQuery({ name: 'branchId', required: false })
    @ApiQuery({ name: 'departmentId', required: false })
    @ApiQuery({ name: 'status', required: false, enum: TicketStatus })
    @ApiQuery({ name: 'priority', required: false })
    @ApiQuery({ name: 'assignedAgent', required: false })
    findAll(
        @Query('branchId') branchId?: string,
        @Query('departmentId') departmentId?: string,
        @Query('status') status?: TicketStatus,
        @Query('priority') priority?: string,
        @Query('assignedAgent') assignedAgent?: string,
    ) {
        return this.ticketsService.findAll({ branchId, departmentId, status, priority, assignedAgent });
    }

    @Get(':id')
    @RequirePermission('tickets', 'read')
    findOne(@Param('id') id: string) {
        return this.ticketsService.findOne(id);
    }

    // Title/description only — see UpdateTicketDto for why.
    @Patch(':id')
    @RequirePermission('tickets', 'update')
    update(@Param('id') id: string, @Body() dto: UpdateTicketDto) {
        return this.ticketsService.update(id, dto);
    }

    @Patch(':id/assign')
    @RequirePermission('tickets', 'assign')
    assign(@Param('id') id: string, @Body() dto: AssignTicketDto, @Req() req: any) {
        return this.ticketsService.assign(id, dto, req.user.userId, req.ip);
    }

    @Patch(':id/status')
    @RequirePermission('tickets', 'update')
    changeStatus(@Param('id') id: string, @Body() dto: ChangeTicketStatusDto, @Req() req: any) {
        return this.ticketsService.changeStatus(id, dto, req.user.userId, req.ip);
    }

    // The ticket raiser rating their own resolved/closed ticket — a personal action, same
    // reasoning as announcements' markRead being gated on 'read' rather than 'update'.
    @Post(':id/feedback')
    @RequirePermission('tickets', 'read')
    submitFeedback(@Param('id') id: string, @Body() dto: SubmitTicketFeedbackDto, @Req() req: any) {
        return this.ticketsService.submitFeedback(id, dto, req.user.userId);
    }

    @Delete(':id')
    @RequirePermission('tickets', 'delete')
    remove(@Param('id') id: string, @Req() req: any) {
        return this.ticketsService.remove(id, req.user.userId, req.ip);
    }
}
