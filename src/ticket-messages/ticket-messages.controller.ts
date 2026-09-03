import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { TicketMessagesService } from './ticket-messages.service';
import { CreateTicketMessageDto } from './dto/create-ticket-message.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

// NOTE: gated under the existing 'tickets' permission, same reasoning as CannedResponsesController.

@Controller('ticket-messages')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class TicketMessagesController {
    constructor(private messagesService: TicketMessagesService) { }

    @Post()
    @RequirePermission('tickets', 'update') // posting to a ticket is effectively updating it
    create(@Body() dto: CreateTicketMessageDto, @Req() req: any) {
        return this.messagesService.create(dto, req.user.userId);
    }

    // Per-ticket chat timeline — e.g. ?ticketId=...
    @Get()
    @RequirePermission('tickets', 'read')
    findForTicket(@Query('ticketId') ticketId: string) {
        return this.messagesService.findForTicket(ticketId);
    }

    @Get(':id')
    @RequirePermission('tickets', 'read')
    findOne(@Param('id') id: string) {
        return this.messagesService.findOne(id);
    }
}
