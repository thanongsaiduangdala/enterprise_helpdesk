import {
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { parse } from 'csv-parse/sync';
import { Department, DepartmentDocument } from './schemas/department.schema';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { BranchesService } from '../branches/branches.service';
import { TicketTypesService } from '../ticket-types/ticket-types.service';

@Injectable()
export class DepartmentsService {
    constructor(
        @InjectModel(Department.name) private departmentModel: Model<DepartmentDocument>,
        private branchesService: BranchesService,
        private ticketTypesService: TicketTypesService,
        private auditLogsService: AuditLogsService,
    ) { }

    private async generateId(): Promise<string> {
        const last = await this.departmentModel
            .findOne({ _id: /^DX\d{3}$/ })
            .sort({ _id: -1 })
            .exec();
        const nextSeq = last ? parseInt(last._id.slice(2), 10) + 1 : 1;
        return `DX${String(nextSeq).padStart(3, '0')}`;
    }




    private async withTicketTypes(department: DepartmentDocument): Promise<Record<string, any>> {
        const allTypes = await this.ticketTypesService.findAll();
        const ticketTypes = allTypes.filter(
            (t) => t.defaultDepartmentId === department._id,
        );
        return { ...department.toObject(), ticketTypes };
    }

    async create(dto: CreateDepartmentDto, actorId: string, ip?: string): Promise<DepartmentDocument> {
        await this.branchesService.findOne(dto.branchId);

        const existing = await this.departmentModel.findOne({
            branchId: dto.branchId,
            name: dto.name,
        });
        if (existing) {
            throw new ConflictException(
                `Department "${dto.name}" already exists in this branch`,
            );
        }

        const _id = await this.generateId();

        try {
            const department = new this.departmentModel({ _id, ...dto });
            const saved = await department.save();

            await this.auditLogsService.log(
                actorId,
                'DEPARTMENT_CREATED',
                'Department',
                saved._id,
                undefined,
                saved.toObject(),
                ip,
            );

            return saved;
        } catch (error: any) {
            if (error.code === 11000) {
                throw new ConflictException(
                    `Department "${dto.name}" already exists in this branch`,
                );
            }
            throw error;
        }
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
                if (!row.branchId || !row.name) {
                    throw new Error('Missing one or more required fields (branchId, name)');
                }
                const dto: CreateDepartmentDto = {
                    branchId: row.branchId,
                    name: row.name,
                    managerIds: row.managerIds ? row.managerIds.split(/[;,]+/).map((id: string) => id.trim()).filter(Boolean) : undefined,
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



    async findAll(): Promise<Record<string, any>[]> {
        const [departments, allTypes] = await Promise.all([
            this.departmentModel.find().exec(),
            this.ticketTypesService.findAll(),
        ]);
        return departments.map((d) => ({
            ...d.toObject(),
            ticketTypes: allTypes.filter((t) => t.defaultDepartmentId === d._id),
        }));
    }

    async findOne(id: string): Promise<Record<string, any>> {
        const department = await this.departmentModel.findById(id).exec();
        if (!department) throw new NotFoundException('Department not found');
        return this.withTicketTypes(department);
    }

    async update(
        id: string,
        dto: UpdateDepartmentDto,
        actorId: string,
        ip?: string,
    ): Promise<Record<string, any>> {
        if (dto.branchId) {
            await this.branchesService.findOne(dto.branchId);
        }

        const before = await this.departmentModel.findById(id).exec();
        if (!before) throw new NotFoundException('Department not found');

        const department = await this.departmentModel
            .findByIdAndUpdate(id, dto, { new: true })
            .exec();
        if (!department) throw new NotFoundException('Department not found');



        const action = dto.managerIds ? 'DEPARTMENT_MANAGER_CHANGED' : 'DEPARTMENT_UPDATED';
        await this.auditLogsService.log(
            actorId,
            action,
            'Department',
            id,
            before.toObject(),
            department.toObject(),
            ip,
        );

        return this.withTicketTypes(department);
    }

    async remove(id: string, actorId: string, ip?: string): Promise<{ deleted: boolean }> {
        const before = await this.departmentModel.findById(id).exec();
        if (!before) throw new NotFoundException('Department not found');

        const result = await this.departmentModel.findByIdAndDelete(id).exec();
        if (!result) throw new NotFoundException('Department not found');

        await this.auditLogsService.log(
            actorId,
            'DEPARTMENT_DELETED',
            'Department',
            id,
            before.toObject(),
            undefined,
            ip,
        );

        return { deleted: true };
    }
}