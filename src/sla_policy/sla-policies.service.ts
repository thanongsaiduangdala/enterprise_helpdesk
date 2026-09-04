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
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class SlaPoliciesService {
    constructor(
        @InjectModel(SlaPolicy.name) private slaPolicyModel: Model<SlaPolicyDocument>,
        private auditLogsService: AuditLogsService,
    ) { }

    async create(dto: CreateSlaPolicyDto, actorId: string, ip?: string) {
        const existing = await this.slaPolicyModel.findOne({
            ticketTypeId: dto.ticketTypeId,
            priority: dto.priority,
        });
        if (existing) {
            throw new ConflictException(
                `An SLA policy already exists for this ticket type + priority`,
            );
        }
        const policy = new this.slaPolicyModel(dto);
        const saved = await policy.save();

        await this.auditLogsService.log(
            actorId,
            'SLA_POLICY_CREATED',
            'SlaPolicy',
            saved._id.toString(),
            undefined,
            saved.toObject(),
            ip,
        );

        return saved;
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

    async update(id: string, dto: UpdateSlaPolicyDto, actorId: string, ip?: string) {
        const before = await this.slaPolicyModel.findById(id).exec();
        if (!before) throw new NotFoundException('SLA policy not found');

        const policy = await this.slaPolicyModel
            .findByIdAndUpdate(id, dto, { new: true })
            .exec();
        if (!policy) throw new NotFoundException('SLA policy not found');

        // Timer changes affect every ticket under this policy going forward — worth its
        // own action name so it's easy to filter "who changed our SLA timers" separately
        // from other policy edits (escalation rules, active flag, etc.).
        const timersChanged = dto.responseTimeMinutes !== undefined || dto.resolutionTimeMinutes !== undefined;
        const action = timersChanged ? 'SLA_POLICY_TIMERS_CHANGED' : 'SLA_POLICY_UPDATED';

        await this.auditLogsService.log(
            actorId,
            action,
            'SlaPolicy',
            id,
            before.toObject(),
            policy.toObject(),
            ip,
        );

        return policy;
    }

    async remove(id: string, actorId: string, ip?: string) {
        const before = await this.slaPolicyModel.findById(id).exec();
        if (!before) throw new NotFoundException('SLA policy not found');

        const result = await this.slaPolicyModel.findByIdAndDelete(id).exec();
        if (!result) throw new NotFoundException('SLA policy not found');

        await this.auditLogsService.log(
            actorId,
            'SLA_POLICY_DELETED',
            'SlaPolicy',
            id,
            before.toObject(),
            undefined,
            ip,
        );

        return { deleted: true };
    }
}