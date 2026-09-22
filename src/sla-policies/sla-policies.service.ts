import {
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { parse } from 'csv-parse/sync';
import { SlaPolicy, SlaPolicyDocument } from './schemas/sla-policy.schema';
import { CreateSlaPolicyDto } from './dto/create-sla-policy.dto';
import { UpdateSlaPolicyDto } from './dto/update-sla-policy.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { TicketTypesService } from '../ticket-types/ticket-types.service';

@Injectable()
export class SlaPoliciesService {
    constructor(
        @InjectModel(SlaPolicy.name) private slaPolicyModel: Model<SlaPolicyDocument>,
        private auditLogsService: AuditLogsService,
        private ticketTypesService: TicketTypesService,
    ) { }

    async create(dto: CreateSlaPolicyDto, actorId: string, ip?: string) {
        await this.ticketTypesService.findOne(dto.ticketTypeId);

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

    async bulkImport(fileBuffer: Buffer, actorId: string, ip?: string) {
        let rows: Record<string, string>[];
        try {
            rows = parse(fileBuffer, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });
        } catch (err: any) {
            throw new ConflictException(`Could not parse CSV file: ${err.message}`);
        }

        const results: Array<{ row: number; reference: string; success: boolean; error?: string }> = [];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNumber = i + 2;
            try {
                if (!row.name || !row.ticketTypeId || !row.priority) {
                    throw new Error('Missing one or more required fields (name, ticketTypeId, priority)');
                }
                const responseTimeMinutes = Number(row.responseTimeMinutes);
                const resolutionTimeMinutes = Number(row.resolutionTimeMinutes);
                if (!Number.isInteger(responseTimeMinutes) || responseTimeMinutes < 1) {
                    throw new Error('responseTimeMinutes must be a positive integer');
                }
                if (!Number.isInteger(resolutionTimeMinutes) || resolutionTimeMinutes < 1) {
                    throw new Error('resolutionTimeMinutes must be a positive integer');
                }

                const dto: CreateSlaPolicyDto = {
                    name: row.name,
                    ticketTypeId: row.ticketTypeId,
                    priority: row.priority,
                    responseTimeMinutes,
                    resolutionTimeMinutes,
                    isActive: row.isActive ? row.isActive === 'true' || row.isActive === '1' : undefined,
                };

                await this.create(dto, actorId, ip);
                results.push({ row: rowNumber, reference: row.name, success: true });
            } catch (error: any) {
                results.push({ row: rowNumber, reference: row.name ?? '', success: false, error: error.message ?? 'Unknown error' });
            }
        }

        return {
            total: rows.length,
            created: results.filter((r) => r.success).length,
            failed: results.filter((r) => !r.success).length,
            results,
        };
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
        if (dto.ticketTypeId) {
            await this.ticketTypesService.findOne(dto.ticketTypeId);
        }

        const before = await this.slaPolicyModel.findById(id).exec();

        if (!before) throw new NotFoundException('SLA policy not found');

        const policy = await this.slaPolicyModel
            .findByIdAndUpdate(id, dto, { new: true })
            .exec();
        if (!policy) throw new NotFoundException('SLA policy not found');




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

    async findAvailablePriorities(ticketTypeId: string): Promise<string[]> {
        const policies = await this.slaPolicyModel
            .find({ ticketTypeId, isActive: true }, { priority: 1 })
            .exec();
        return policies.map((p) => p.priority);
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