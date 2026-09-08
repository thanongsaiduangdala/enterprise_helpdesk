import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { parse } from 'csv-parse/sync';
import { User, UserDocument } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { RolesService } from '../roles/roles.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { MailService } from '../mail/mail.service';

const SENSITIVE_FIELDS = ['passwordHash', 'password'];

function sanitize(obj: Record<string, any> | null | undefined) {
    if (!obj) return obj;
    const plain = typeof obj.toObject === 'function' ? obj.toObject() : obj;
    const clone = { ...plain };
    for (const field of SENSITIVE_FIELDS) delete clone[field];
    return clone;
}

@Injectable()
export class UsersService {
    constructor(
        @InjectModel(User.name) private userModel: Model<UserDocument>,
        private rolesService: RolesService,
        private auditLogsService: AuditLogsService,
        private mailService: MailService,
    ) { }

    async create(dto: CreateUserDto, actorId: string, ip?: string) {
        await this.rolesService.findOne(dto.role);

        try {
            const passwordHash = await bcrypt.hash(dto.password, 10);
            const { password, ...rest } = dto;
            const user = new this.userModel({ ...rest, passwordHash });
            const saved = await user.save();

            await this.auditLogsService.log(
                actorId,
                'USER_CREATED',
                'User',
                saved._id.toString(),
                undefined,
                sanitize(saved),
                ip,
            );

            return saved;
        } catch (error: any) {
            if (error.code === 11000) {
                const field = Object.keys(error.keyPattern || {})[0] || 'field';
                const value = error.keyValue?.[field];
                throw new ConflictException(`${field} "${value}" is already in use`);
            }
            throw error;
        }
    }

    // "Bulk import (CSV) for large org onboarding" — expects a CSV with headers:
    // employeeCode,firstName,lastName,email,phone,role,branchId,departmentId
    // (no password column — a random temp password is generated per user and emailed
    // to them). Each row is processed independently: one bad row (duplicate email,
    // unknown role, missing field) doesn't stop the rest of the batch, mirroring the
    // per-item try/catch pattern used in SupplyRequestsService.bulkFulfill().
    async bulkImport(fileBuffer: Buffer, actorId: string, ip?: string) {
        let rows: Record<string, string>[];
        try {
            rows = parse(fileBuffer, { columns: true, skip_empty_lines: true, trim: true });
        } catch (err: any) {
            throw new ConflictException(`Could not parse CSV file: ${err.message}`);
        }

        const results: Array<{ row: number; email?: string; success: boolean; error?: string }> = [];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNumber = i + 2; // +2 accounts for the header row and 1-based counting

            try {
                if (!row.email || !row.firstName || !row.lastName || !row.role || !row.branchId || !row.employeeCode) {
                    throw new Error('Missing one or more required fields (employeeCode, firstName, lastName, email, role, branchId)');
                }

                const tempPassword = crypto.randomBytes(6).toString('hex'); // 12-char temp password

                const dto: CreateUserDto = {
                    employeeCode: row.employeeCode,
                    firstName: row.firstName,
                    lastName: row.lastName,
                    email: row.email,
                    password: tempPassword,
                    phone: row.phone || undefined,
                    role: row.role,
                    branchId: row.branchId,
                    departmentId: row.departmentId || undefined,
                };

                const user = await this.create(dto, actorId, ip);

                await this.mailService.sendMail(
                    user.email,
                    'Your Enterprise Helpdesk account has been created',
                    `<p>Hi ${user.firstName},</p>
                     <p>An account has been created for you on the Enterprise Helpdesk system.</p>
                     <p>Temporary password: <b>${tempPassword}</b></p>
                     <p>Please log in and change your password as soon as possible.</p>`,
                );

                results.push({ row: rowNumber, email: user.email, success: true });
            } catch (error: any) {
                results.push({ row: rowNumber, email: row.email, success: false, error: error.message ?? 'Unknown error' });
            }
        }

        return {
            total: rows.length,
            created: results.filter((r) => r.success).length,
            failed: results.filter((r) => !r.success).length,
            results,
        };
    }

    findByEmail(email: string) {
        return this.userModel.findOne({ email }).populate('role').exec();
    }

    async setActive(id: string, isActive: boolean, actorId: string, ip?: string) {
        const before = await this.userModel.findById(id).exec();
        if (!before) throw new NotFoundException('User not found');

        const update: any = { isActive };
        if (!isActive) update.deactivatedAt = new Date();
        else update.deactivatedAt = undefined;

        const user = await this.userModel.findByIdAndUpdate(id, update, { new: true }).exec();
        if (!user) throw new NotFoundException('User not found');

        await this.auditLogsService.log(
            actorId,
            isActive ? 'USER_REACTIVATED' : 'USER_DEACTIVATED',
            'User',
            id,
            sanitize(before),
            sanitize(user),
            ip,
        );

        return user;
    }

    findAll(filters: { branchId?: string; departmentId?: string; role?: string } = {}) {
        const query: any = {};
        if (filters.branchId) query.branchId = filters.branchId;
        if (filters.departmentId) query.departmentId = filters.departmentId;
        if (filters.role) query.role = filters.role;
        return this.userModel.find(query).populate('role').exec();
    }

    findActiveByBranch(branchId: string) {
        return this.userModel.find({ branchId, isActive: true }).exec();
    }

    findActiveByDepartment(departmentId: string) {
        return this.userModel.find({ departmentId, isActive: true }).exec();
    }

    findAllActive() {
        return this.userModel.find({ isActive: true }).exec();
    }

    // Used by ReportsDigestService to find who should receive the weekly digest —
    // anyone active whose role is in the given list of role IDs.
    findActiveByRoleIds(roleIds: string[]) {
        return this.userModel.find({ role: { $in: roleIds }, isActive: true }).exec();
    }

    async findOne(id: string) {
        const user = await this.userModel.findById(id).populate('role').exec();
        if (!user) throw new NotFoundException('User not found');
        return user;
    }

    async update(id: string, dto: UpdateUserDto, actorId: string, ip?: string) {
        if (dto.role) {
            await this.rolesService.findOne(dto.role);
        }

        const before = await this.userModel.findById(id).populate('role').exec();
        if (!before) throw new NotFoundException('User not found');

        const user = await this.userModel
            .findByIdAndUpdate(id, dto, { new: true })
            .populate('role')
            .exec();
        if (!user) throw new NotFoundException('User not found');

        const action = dto.role && dto.role !== (before.role as any)?._id?.toString()
            ? 'USER_ROLE_CHANGED' : 'USER_UPDATED';

        await this.auditLogsService.log(
            actorId,
            action,
            'User',
            id,
            sanitize(before),
            sanitize(user),
            ip,
        );

        return user;
    }

    // --- MFA ---

    // Generates and stores a new TOTP secret (not yet "enabled" until confirmed via
    // confirmMfaEnabled). Called both for voluntary self-setup and forced setup.
    async setMfaSecret(id: string, secret: string) {
        const user = await this.userModel.findByIdAndUpdate(
            id,
            { 'mfa.secret': secret },
            { new: true },
        ).exec();
        if (!user) throw new NotFoundException('User not found');
        return user;
    }

    async confirmMfaEnabled(id: string) {
        const user = await this.userModel.findByIdAndUpdate(
            id,
            { 'mfa.enabled': true, 'mfa.method': 'totp' },
            { new: true },
        ).exec();
        if (!user) throw new NotFoundException('User not found');
        return user;
    }

    async findOneRaw(id: string) {
        // Unlike findOne(), this doesn't populate role — used internally by AuthService
        // where only mfa.secret / passwordHash are needed, not the full role object.
        const user = await this.userModel.findById(id).exec();
        if (!user) throw new NotFoundException('User not found');
        return user;
    }

    async remove(id: string, actorId: string, ip?: string) {
        const before = await this.userModel.findById(id).exec();
        if (!before) throw new NotFoundException('User not found');

        const result = await this.userModel.findByIdAndDelete(id).exec();
        if (!result) throw new NotFoundException('User not found');

        await this.auditLogsService.log(
            actorId,
            'USER_DELETED',
            'User',
            id,
            sanitize(before),
            undefined,
            ip,
        );

        return result;
    }
}
