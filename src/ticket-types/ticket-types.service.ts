import {
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { parse } from 'csv-parse/sync';
import { TicketType, TicketTypeDocument } from './schemas/ticket-type.schema';
import { CreateTicketTypeDto } from './dto/create-ticket-type.dto';
import { UpdateTicketTypeDto } from './dto/update-ticket-type.dto';

@Injectable()
export class TicketTypesService {
    constructor(
        @InjectModel(TicketType.name) private ticketTypeModel: Model<TicketTypeDocument>,
    ) { }

    private async generateId(): Promise<string> {
        const last = await this.ticketTypeModel
            .findOne({ _id: /^TT\d{3}$/ })
            .sort({ _id: -1 })
            .exec();
        const nextSeq = last ? parseInt(last._id.slice(2), 10) + 1 : 1;
        return `TT${String(nextSeq).padStart(3, '0')}`;
    }

    async create(dto: CreateTicketTypeDto) {
        const existing = await this.ticketTypeModel.findOne({ name: dto.name });
        if (existing) {
            throw new ConflictException(`Ticket type "${dto.name}" already exists`);
        }
        const _id = await this.generateId();
        const ticketType = new this.ticketTypeModel({ _id, ...dto });
        return ticketType.save();
    }

    async bulkImport(fileBuffer: Buffer) {
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
                if (!row.name || !row.defaultDepartmentId) {
                    throw new Error('Missing one or more required fields (name, defaultDepartmentId)');
                }
                const dto: CreateTicketTypeDto = {
                    name: row.name,
                    defaultDepartmentId: row.defaultDepartmentId,
                    defaultPriority: row.defaultPriority || undefined,
                    description: row.description || undefined,
                    isActive: row.isActive ? row.isActive === 'true' || row.isActive === '1' : undefined,
                };
                await this.create(dto);
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
        return this.ticketTypeModel.find().exec();
    }

    async findOne(id: string) {
        const ticketType = await this.ticketTypeModel.findById(id).exec();
        if (!ticketType) throw new NotFoundException('Ticket type not found');
        return ticketType;
    }

    async update(id: string, dto: UpdateTicketTypeDto) {
        const ticketType = await this.ticketTypeModel
            .findByIdAndUpdate(id, dto, { new: true })
            .exec();
        if (!ticketType) throw new NotFoundException('Ticket type not found');
        return ticketType;
    }

    async remove(id: string) {
        const result = await this.ticketTypeModel.findByIdAndDelete(id).exec();
        if (!result) throw new NotFoundException('Ticket type not found');
        return { deleted: true };
    }
}