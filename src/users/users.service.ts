import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { RolesService } from '../roles/roles.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';



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

