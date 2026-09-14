import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TicketMessage, TicketMessageDocument } from './schemas/ticket-message.schema';
import { CreateTicketMessageDto } from './dto/create-ticket-message.dto';
import { CannedResponsesService } from '../canned-responses/canned-responses.service';
import { TicketsService } from '../tickets/tickets.service';
import { NotificationsService } from '../notifications/notifications.service';
import { assertInvolvedInTicket } from '../common/utils/ticket-access.util';

@Injectable()
export class TicketMessagesService {
    constructor(
        @InjectModel(TicketMessage.name) private messageModel: Model<TicketMessageDocument>,
        private cannedResponsesService: CannedResponsesService,
        private ticketsService: TicketsService,
        private notificationsService: NotificationsService,
    ) { }

    async create(dto: CreateTicketMessageDto, senderId: string, permissions: any[]) {
        const ticket = await this.ticketsService.findOne(dto.ticketId);
        assertInvolvedInTicket(ticket, senderId, permissions);

        if (dto.isCannedResponse) {
            if (!dto.cannedResponseId) {
                throw new BadRequestException('cannedResponseId is required when isCannedResponse is true');
            }
            await this.cannedResponsesService.findOne(dto.cannedResponseId);
        }

        const saved = await new this.messageModel({ ...dto, senderId }).save();

        // Notify "the other side" of the conversation — whichever of raiser/agent didn't just send this.
        const raisedById = (ticket as any).raisedBy?.toString();
        const assignedAgentId = (ticket as any).assignedAgent?.toString();
        const recipients = [raisedById, assignedAgentId].filter(
            (id): id is string => !!id && id !== senderId,
        );

        await Promise.all(
            recipients.map((recipientId) =>
                this.notificationsService.notify(
                    recipientId,
                    'TICKET_MESSAGE',
                    (ticket as any)._id.toString(),
                    'Ticket',
                    `New message on ${(ticket as any).ticketNumber}`,
                    dto.body.length > 80 ? `${dto.body.slice(0, 80)}...` : dto.body,
                ),
            ),
        );

        return saved;
    }

    async findForTicket(ticketId: string, userId: string, permissions: any[]) {
        const ticket = await this.ticketsService.findOne(ticketId);
        assertInvolvedInTicket(ticket, userId, permissions);
        return this.messageModel.find({ ticketId }).sort({ createdAt: 1 }).populate('senderId').exec();
    }

    async findOne(id: string, userId: string, permissions: any[]) {
        const message = await this.messageModel.findById(id).populate('senderId').exec();
        if (!message) throw new NotFoundException('Message not found');

        const ticket = await this.ticketsService.findOne(message.ticketId);
        assertInvolvedInTicket(ticket, userId, permissions);

        return message;
    }
}