import {
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { parse } from 'csv-parse/sync';
import { Branch, BranchDocument } from './schemas/branch.schema';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class BranchesService {
    constructor(
        @InjectModel(Branch.name) private branchModel: Model<BranchDocument>,
        private auditLogsService: AuditLogsService,
    ) { }

    private async generateId(): Promise<string> {
        const last = await this.branchModel
            .findOne({ _id: /^BX\d{3}$/ })
            .sort({ _id: -1 })
            .exec();
        const nextSeq = last ? parseInt(last._id.slice(2), 10) + 1 : 1;
        return `BX${String(nextSeq).padStart(3, '0')}`;
    }

    async create(dto: CreateBranchDto, actorId: string, ip?: string) {
        const existing = await this.branchModel.findOne({ name: dto.name });
        if (existing) {
            throw new ConflictException(`Branch "${dto.name}" already exists`);
        }
        const _id = await this.generateId();
        const branch = new this.branchModel({ _id, ...dto });
        const saved = await branch.save();

        await this.auditLogsService.log(
            actorId,
            'BRANCH_CREATED',
            'Branch',
            saved._id,
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
                if (!row.name || !row.address || !row.city || !row.country || !row.timezone) {
                    throw new Error('Missing one or more required fields (name, address, city, country, timezone)');
                }
                const dto: CreateBranchDto = {
                    name: row.name,
                    location: {
                        address: row.address,
                        city: row.city,
                        country: row.country,
                        timezone: row.timezone,
                    },
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
        return this.branchModel.find().exec();
    }

    async findOne(id: string) {
        const branch = await this.branchModel.findById(id).exec();
        if (!branch) throw new NotFoundException('Branch not found');
        return branch;
    }

    async update(id: string, dto: UpdateBranchDto, actorId: string, ip?: string) {
        const before = await this.branchModel.findById(id).exec();
        if (!before) throw new NotFoundException('Branch not found');

        const branch = await this.branchModel
            .findByIdAndUpdate(id, dto, { new: true })
            .exec();
        if (!branch) throw new NotFoundException('Branch not found');

        await this.auditLogsService.log(
            actorId,
            'BRANCH_UPDATED',
            'Branch',
            id,
            before.toObject(),
            branch.toObject(),
            ip,
        );

        return branch;
    }

    async remove(id: string, actorId: string, ip?: string) {
        const before = await this.branchModel.findById(id).exec();
        if (!before) throw new NotFoundException('Branch not found');

        const result = await this.branchModel.findByIdAndDelete(id).exec();
        if (!result) throw new NotFoundException('Branch not found');

        await this.auditLogsService.log(
            actorId,
            'BRANCH_DELETED',
            'Branch',
            id,
            before.toObject(),
            undefined,
            ip,
        );

        return { deleted: true };
    }
}