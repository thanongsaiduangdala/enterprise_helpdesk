import {
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SlaPolicy, SlaPolicyDocument } from './schemas/sla-policy.schema';
import { CreateSlaPolicyDto } from './dto/create-sla-policy.dto';
import { UpdateSlaPolicyDto } from './dto/update-sla-policy.dto';

@Injectable()
export class SlaPoliciesService {
    constructor(
        @InjectModel(SlaPolicy.name) private slaPolicyModel: Model<SlaPolicyDocument>,
    ) { }

    private async generateId(): Promise<string> {
        const last = await this.slaPolicyModel
            .findOne({ _id: /^SLA\d{3}$/ })
            .sort({ _id: -1 })
            .exec();
        const nextSeq = last ? parseInt(last._id.slice(3), 10) + 1 : 1;
        return `SLA${String(nextSeq).padStart(3, '0')}`;
    }

    async create(dto: CreateSlaPolicyDto) {
        const existing = await this.slaPolicyModel.findOne({
            ticketTypeId: dto.ticketTypeId,
            priority: dto.priority,
        });
        if (existing) {
            throw new ConflictException(
                `An SLA policy already exists for this ticket type + priority`,
            );
        }
        const _id = await this.generateId();
        const policy = new this.slaPolicyModel({ _id, ...dto });
        return policy.save();
    }

    findAll() {
        return this.slaPolicyModel.find().exec();
    }

    async findOne(id: string) {
        const policy = await this.slaPolicyModel.findById(id).exec();
        if (!policy) throw new NotFoundException('SLA policy not found');
        return policy;
    }

    findByTicketTypeAndPriority(ticketTypeId: string, priority: string) {
        return this.slaPolicyModel
            .findOne({ ticketTypeId, priority, isActive: true })
            .exec();
    }

    async update(id: string, dto: UpdateSlaPolicyDto) {
        const policy = await this.slaPolicyModel
            .findByIdAndUpdate(id, dto, { new: true })
            .exec();
        if (!policy) throw new NotFoundException('SLA policy not found');
        return policy;
    }

    async remove(id: string) {
        const result = await this.slaPolicyModel.findByIdAndDelete(id).exec();
        if (!result) throw new NotFoundException('SLA policy not found');
        return { deleted: true };
    }
}