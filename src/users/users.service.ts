import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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
import { SessionsService } from '../sessions/sessions.service';
import { getEnabledMethods } from '../common/utils/mfa-methods.util';

const SENSITIVE_FIELDS = ['passwordHash', 'password'];

function sanitize(obj: Record<string, any> | null | undefined) {
    if (!obj) return obj;
    const plain = typeof obj.toObject === 'function' ? obj.toObject() : obj;
    const clone = { ...plain };
    for (const field of SENSITIVE_FIELDS) delete clone[field];
    // ຢ່າໃຫ້ secret / PIN hash ຂອງ MFA ຕິດເຂົ້າໄປໃນ audit log
    if (clone.mfa) {
        const { secret, pendingSecret, pinHash, pendingPinHash, ...safeMfa } = clone.mfa;
        void secret; void pendingSecret; void pinHash; void pendingPinHash;
        clone.mfa = safeMfa;
    }
    return clone;
}

@Injectable()
export class UsersService {
    constructor(
        @InjectModel(User.name) private userModel: Model<UserDocument>,
        private rolesService: RolesService,
        private auditLogsService: AuditLogsService,
        private mailService: MailService,
        private sessionsService: SessionsService,
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
            const rowNumber = i + 2;

            try {
                if (!row.email || !row.firstName || !row.lastName || !row.role || !row.branchId || !row.employeeCode) {
                    throw new Error('Missing one or more required fields (employeeCode, firstName, lastName, email, role, branchId)');
                }

                const tempPassword = crypto.randomBytes(6).toString('hex');

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

    /** ຄົ້ນຫາດ້ວຍລະຫັດພະນັກງານ (ບໍ່ແຍກຕົວພິມໃຫຍ່/ນ້ອຍ — ໃຫ້ຕົງກັບໜ້າຈໍ) */
    findByEmployeeCode(employeeCode: string) {
        const escaped = (employeeCode || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return this.userModel.findOne({ employeeCode: new RegExp(`^${escaped}$`, 'i') }).exec();
    }

    /** ຂໍ້ມູນຂັ້ນຕ່ຳເພື່ອໃຫ້ຜູ້ເບີກຈ່າຍກວດຕົວຕົນຜູ້ມາຮັບ (ບໍ່ສົ່ງເບີໂທ/ອີເມວ/ຂໍ້ມູນລະອຽດ) */
    async lookupByEmployeeCode(employeeCode: string) {
        const u = await this.findByEmployeeCode(employeeCode);
        if (!u) throw new NotFoundException(`Employee code "${employeeCode}" not found`);
        return {
            _id: String(u._id),
            employeeCode: u.employeeCode,
            firstName: u.firstName,
            lastName: u.lastName,
            departmentId: u.departmentId,
            branchId: u.branchId,
            isActive: u.isActive !== false,
        };
    }



    async setActive(id: string, isActive: boolean, actorId: string, ip?: string) {
        const before = await this.userModel.findById(id).exec();
        if (!before) throw new NotFoundException('User not found');

        const update: any = { isActive };
        if (!isActive) update.deactivatedAt = new Date();
        else update.deactivatedAt = undefined;

        const user = await this.userModel.findByIdAndUpdate(id, update, { new: true }).exec();
        if (!user) throw new NotFoundException('User not found');

        if (!isActive) {
            await this.sessionsService.revokeAllForUser(id);
        }

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

    /** Active users in a branch + department whose role name is in `roleNames` (role populated). */
    async findAssignmentCandidates(branchId: string, departmentId: string, roleNames: string[]) {
        const users = await this.userModel
            .find({ branchId, departmentId, isActive: true })
            .populate('role')
            .exec();
        return users.filter((u: any) => roleNames.includes(u.role?.name));
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



    findActiveByRoleIds(roleIds: string[]) {
        return this.userModel.find({ role: { $in: roleIds }, isActive: true }).exec();
    }

    async findOne(id: string) {
        const user = await this.userModel.findById(id).populate('role').populate('departmentId').exec();
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

    async setMfaSecret(id: string, secret: string) {
        const user = await this.userModel.findByIdAndUpdate(
            id,
            { 'mfa.secret': secret },
            { new: true },
        ).exec();
        if (!user) throw new NotFoundException('User not found');
        return user;
    }

    async setPendingMfaSecret(id: string, secret: string) {
        const user = await this.userModel.findByIdAndUpdate(
            id,
            { $set: { 'mfa.pendingSecret': secret, 'mfa.pendingMethod': 'totp' }, $unset: { 'mfa.pendingPinHash': '' } },
            { new: true },
        ).exec();
        if (!user) throw new NotFoundException('User not found');
        return user;
    }

    async setPendingMfaMethod(id: string, method: string) {
        const user = await this.userModel.findByIdAndUpdate(
            id,
            { 'mfa.pendingMethod': method, $unset: { 'mfa.pendingSecret': '', 'mfa.pendingPinHash': '' } },
            { new: true },
        ).exec();
        if (!user) throw new NotFoundException('User not found');
        return user;
    }

    async setPendingMfaPin(id: string, pinHash: string) {
        const user = await this.userModel.findByIdAndUpdate(
            id,
            { $set: { 'mfa.pendingPinHash': pinHash, 'mfa.pendingMethod': 'pin' }, $unset: { 'mfa.pendingSecret': '' } },
            { new: true },
        ).exec();
        if (!user) throw new NotFoundException('User not found');
        return user;
    }

    // ເພີ່ມວິທີທີ່ pending ເຂົ້າໃນລາຍການ methods (ບໍ່ລຶບວິທີອື່ນທີ່ເປີດຢູ່ແລ້ວ)
    async confirmMfaEnabled(id: string) {
        const user = await this.userModel.findById(id).exec();
        if (!user) throw new NotFoundException('User not found');

        const method = user.mfa?.pendingMethod;
        if (!method) {
            throw new NotFoundException('No pending MFA setup to confirm');
        }

        const current = getEnabledMethods(user.mfa);
        const methods = current.includes(method as any) ? current : [...current, method as any];

        const set: Record<string, any> = {
            'mfa.enabled': true,
            'mfa.methods': methods,
            'mfa.method': methods[0],
        };
        const unset: Record<string, ''> = { 'mfa.pendingMethod': '' };

        if (method === 'totp') {
            if (!user.mfa?.pendingSecret) {
                throw new NotFoundException('No pending MFA secret to confirm');
            }
            set['mfa.secret'] = user.mfa.pendingSecret;
            unset['mfa.pendingSecret'] = '';
        }

        if (method === 'pin') {
            if (!user.mfa?.pendingPinHash) {
                throw new NotFoundException('No pending PIN to confirm');
            }
            set['mfa.pinHash'] = user.mfa.pendingPinHash;
            unset['mfa.pendingPinHash'] = '';
        }

        const updated = await this.userModel.findByIdAndUpdate(
            id,
            { $set: set, $unset: unset },
            { new: true },
        ).exec();
        if (!updated) throw new NotFoundException('User not found');
        return updated;
    }

    // ປິດວິທີ MFA ໜຶ່ງວິທີ (ວິທີອື່ນຍັງເປີດຢູ່ຕາມເດີມ)
    async removeMfaMethod(id: string, method: string) {
        const user = await this.userModel.findById(id).exec();
        if (!user) throw new NotFoundException('User not found');

        const current = getEnabledMethods(user.mfa);
        if (!current.includes(method as any)) {
            throw new BadRequestException('This MFA method is not enabled');
        }
        const methods = current.filter((m) => m !== method);

        const set: Record<string, any> = {
            'mfa.enabled': methods.length > 0,
            'mfa.methods': methods,
        };
        const unset: Record<string, ''> = {};
        if (methods.length > 0) set['mfa.method'] = methods[0];
        else unset['mfa.method'] = '';

        if (method === 'totp') {
            unset['mfa.secret'] = '';
            unset['mfa.pendingSecret'] = '';
        }
        if (method === 'pin') {
            unset['mfa.pinHash'] = '';
            unset['mfa.pendingPinHash'] = '';
        }
        if (user.mfa?.pendingMethod === method) unset['mfa.pendingMethod'] = '';

        const update: Record<string, any> = { $set: set };
        if (Object.keys(unset).length > 0) update.$unset = unset;

        const updated = await this.userModel.findByIdAndUpdate(id, update, { new: true }).exec();
        if (!updated) throw new NotFoundException('User not found');
        return updated;
    }

    async setPasswordHash(id: string, passwordHash: string) {
        const updated = await this.userModel.findByIdAndUpdate(id, { $set: { passwordHash } }).exec();
        if (!updated) throw new NotFoundException('User not found');
    }

    async recordLoginFailure(id: string, maxAttempts: number, lockMs: number) {
        const user = await this.userModel.findById(id).exec();
        if (!user) return { locked: false, attempts: 0 };
        const attempts = (user.failedLoginAttempts ?? 0) + 1;
        const locked = attempts >= maxAttempts;
        await this.userModel
            .findByIdAndUpdate(id, {
                $set: locked
                    ? { failedLoginAttempts: 0, lockedUntil: new Date(Date.now() + lockMs) }
                    : { failedLoginAttempts: attempts },
            })
            .exec();
        return { locked, attempts };
    }

    async recordLoginSuccess(id: string) {
        await this.userModel
            .findByIdAndUpdate(id, {
                $set: { lastLoginAt: new Date(), failedLoginAttempts: 0 },
                $unset: { lockedUntil: '' },
            })
            .exec();
    }

    async findOneRaw(id: string) {


        const user = await this.userModel.findById(id).exec();
        if (!user) throw new NotFoundException('User not found');
        return user;
    }

    async remove(id: string, actorId: string, ip?: string) {
        const before = await this.userModel.findById(id).exec();
        if (!before) throw new NotFoundException('User not found');

        const result = await this.userModel.findByIdAndDelete(id).exec();
        if (!result) throw new NotFoundException('User not found');

        await this.sessionsService.revokeAllForUser(id);

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
