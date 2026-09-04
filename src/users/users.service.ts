import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { RolesService } from '../roles/roles.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

// Fields never written to the audit log, even in "after" snapshots — a password hash
// has no business sitting in a searchable, exported audit trail.
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
    ) { }

    // actorId/ip identify who did this and from where — both required by the audit-log
    // spec ("filter by actor") and only available at the controller layer (from the JWT
    // and the request), so they're threaded through as parameters rather than looked up here.
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
                undefined, // no "before" — nothing existed yet
                sanitize(saved),
                ip,
            );

            return saved;
        } catch (error: any) {
            if (error.code === 11000) {
                throw new ConflictException('Email already in use');
            }
            throw error;
        }
    }

    findByEmail(email: string) {
        return this.userModel.findOne({ email }).populate('role').exec();
    }

    findAll() {
        return this.userModel.find().populate('role').exec();
    }

    // Used by AnnouncementsService to determine who to notify for each scope.
    // Only active users — no point notifying someone who's been deactivated/offboarded.
    findActiveByBranch(branchId: string) {
        return this.userModel.find({ branchId, isActive: true }).exec();
    }

    findActiveByDepartment(departmentId: string) {
        return this.userModel.find({ departmentId, isActive: true }).exec();
    }

    findAllActive() {
        return this.userModel.find({ isActive: true }).exec();
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

        // Fetched separately (rather than relying on findByIdAndUpdate's pre-update doc)
        // so "before" reflects the exact same shape/population as "after" for a clean diff.
        const before = await this.userModel.findById(id).populate('role').exec();
        if (!before) throw new NotFoundException('User not found');

        const user = await this.userModel
            .findByIdAndUpdate(id, dto, { new: true })
            .populate('role')
            .exec();
        if (!user) throw new NotFoundException('User not found');

        // Role reassignment gets its own action name — the spec calls out "role changes"
        // as a specifically sensitive action distinct from a generic profile edit.
        const action = dto.role && dto.role !== before.role?.toString() ? 'USER_ROLE_CHANGED' : 'USER_UPDATED';

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
            undefined, // no "after" — nothing exists post-delete
            ip,
        );

        return result;
    }
}

