import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { parse } from 'csv-parse/sync';
import { Role, RoleDocument } from './schemas/role.schema';
import { Counter, CounterDocument } from './schemas/counter.schema';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class RolesService {
    constructor(
        @InjectModel(Role.name) private roleModel: Model<RoleDocument>,
        @InjectModel(Counter.name) private counterModel: Model<CounterDocument>,
        private auditLogsService: AuditLogsService,
    ) { }

    private async generateRoleId(): Promise<string> {
        const last = await this.roleModel
            .findOne({ _id: /^R\d{3}$/ })
            .sort({ _id: -1 })
            .exec();
        const nextSeq = last ? parseInt(last._id.slice(1), 10) + 1 : 1;
        return `R${String(nextSeq).padStart(3, '0')}`;
    }

    async create(dto: CreateRoleDto, actorId: string, ip?: string) {
        const existing = await this.roleModel.findOne({ name: dto.name });
        if (existing) {
            throw new ConflictException(`Role "${dto.name}" already exists`);
        }
        const _id = await this.generateRoleId();
        const role = new this.roleModel({ _id, ...dto, isSystemRole: false });
        const saved = await role.save();

        await this.auditLogsService.log(
            actorId,
            'ROLE_CREATED',
            'Role',
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
                if (!row.name) {
                    throw new Error('Missing required field: name');
                }
                const permissions = row.permissions
                    ? row.permissions
                        .split(/[;|]+/)
                        .map((group: string) => group.trim())
                        .filter(Boolean)
                        .map((group: string) => {
                            const [module, actionsRaw] = group.split(':');
                            if (!module || !actionsRaw) {
                                throw new Error(`Invalid permission group "${group}" — expected "module:action1,action2"`);
                            }
                            const actions = actionsRaw
                                .split(/[, ]+/)
                                .map((a: string) => a.trim())
                                .filter(Boolean);
                            if (actions.length === 0) {
                                throw new Error(`No actions found for permission group "${group}"`);
                            }
                            return { module: module.trim(), actions };
                        })
                    : undefined;

                const dto: CreateRoleDto = {
                    name: row.name,
                    permissions,
                    mfaRequired: row.mfaRequired ? row.mfaRequired === 'true' || row.mfaRequired === '1' : undefined,
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
        return this.roleModel.find().exec();
    }

    async findRolesWithPermission(module: string, action: string) {
        return this.roleModel.find({
            permissions: { $elemMatch: { module, actions: action } },
        }).exec();
    }



    findByName(name: string) {
        return this.roleModel.findOne({ name }).exec();
    }

    async findOne(id: string) {
        const role = await this.roleModel.findById(id).exec();
        if (!role) throw new NotFoundException('Role not found');
        return role;
    }

    async update(id: string, dto: UpdateRoleDto, actorId: string, ip?: string) {
        const before = await this.roleModel.findById(id).exec();
        if (!before) throw new NotFoundException('Role not found');

        const role = await this.roleModel
            .findByIdAndUpdate(id, dto, { new: true })
            .exec();
        if (!role) throw new NotFoundException('Role not found');

        const action = dto.permissions ? 'ROLE_PERMISSION_CHANGED' : 'ROLE_UPDATED';
        await this.auditLogsService.log(
            actorId,
            action,
            'Role',
            id,
            before.toObject(),
            role.toObject(),
            ip,
        );

        return role;
    }

    async remove(id: string, actorId: string, ip?: string) {
        const role = await this.findOne(id);
        if (role.isSystemRole) {
            throw new BadRequestException(
                `"${role.name}" is a built-in role and cannot be deleted`,
            );
        }
        await this.roleModel.deleteOne({ _id: id }).exec();

        await this.auditLogsService.log(
            actorId,
            'ROLE_DELETED',
            'Role',
            id,
            role.toObject(),
            undefined,
            ip,
        );

        return { deleted: true };
    }
}