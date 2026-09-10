import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { TicketMessagesService } from './ticket-messages.service';
import { CreateTicketMessageDto } from './dto/create-ticket-message.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

@Controller('ticket-messages')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class TicketMessagesController {
    constructor(private messagesService: TicketMessagesService) { }

    @Post()
    @RequirePermission('tickets', 'read')
    create(@Body() dto: CreateTicketMessageDto, @Req() req: any) {
        return this.messagesService.create(dto, req.user.userId, req.user.permissions);
    }

    @Get()
    @RequirePermission('tickets', 'read')
    findForTicket(@Query('ticketId') ticketId: string, @Req() req: any) {
        return this.messagesService.findForTicket(ticketId, req.user.userId, req.user.permissions);
    }

    @Get(':id')
    @RequirePermission('tickets', 'read')
    findOne(@Param('id') id: string, @Req() req: any) {
        return this.messagesService.findOne(id, req.user.userId, req.user.permissions);
    }
}