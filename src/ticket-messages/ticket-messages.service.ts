import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TicketMessage, TicketMessageDocument } from './schemas/ticket-message.schema';
import { CreateTicketMessageDto } from './dto/create-ticket-message.dto';
import { CannedResponsesService } from '../canned-responses/canned-responses.service';

@Injectable()
export class TicketMessagesService {
    constructor(
        @InjectModel(TicketMessage.name) private messageModel: Model<TicketMessageDocument>,
        private cannedResponsesService: CannedResponsesService,
    ) { }

    // Same gap-filling pattern as the other custom-ID collections.
    private async generateId(): Promise<string> {
        const messages = await this.messageModel
            .find({ _id: /^TM\d{3}$/ }, { _id: 1 })
            .sort({ _id: 1 })
            .exec();
        const usedNumbers = new Set(messages.map((m) => parseInt(m._id.slice(2), 10)));
        let seq = 1;
        while (usedNumbers.has(seq)) seq++;
        return `TM${String(seq).padStart(3, '0')}`;
    }

    async create(dto: CreateTicketMessageDto, senderId: string) {
        if (dto.isCannedResponse) {
            if (!dto.cannedResponseId) {
                throw new BadRequestException('cannedResponseId is required when isCannedResponse is true');
            }
            await this.cannedResponsesService.findOne(dto.cannedResponseId); // throws 404 if missing
        }
        const _id = await this.generateId();
        return new this.messageModel({ _id, ...dto, senderId }).save();
    }

    // Per-ticket message timeline, oldest first — the chat view.
    findForTicket(ticketId: string) {
        return this.messageModel.find({ ticketId }).sort({ createdAt: 1 }).exec();
    }

    async findOne(id: string) {
        const message = await this.messageModel.findById(id).exec();
        if (!message) throw new NotFoundException('Message not found');
        return message;
    }
}
