import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Role, RoleDocument } from './schemas/role.schema';
import { Counter, CounterDocument } from './schemas/counter.schema';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@Injectable()
export class RolesService {
    constructor(
        @InjectModel(Role.name) private roleModel: Model<RoleDocument>,
        @InjectModel(Counter.name) private counterModel: Model<CounterDocument>,
    ) { }

    private async generateRoleId(): Promise<string> {
        const last = await this.roleModel
            .findOne({ _id: /^R\d{3}$/ })
            .sort({ _id: -1 })
            .exec();
        const nextSeq = last ? parseInt(last._id.slice(1), 10) + 1 : 1;
        return `R${String(nextSeq).padStart(3, '0')}`;
    }

    async create(dto: CreateRoleDto) {
        const existing = await this.roleModel.findOne({ name: dto.name });
        if (existing) {
            throw new ConflictException(`Role "${dto.name}" already exists`);
        }
        const _id = await this.generateRoleId();
        const role = new this.roleModel({ _id, ...dto, isSystemRole: false });
        return role.save();
    }

    findAll() {
        return this.roleModel.find().exec();
    }

    async findOne(id: string) {
        const role = await this.roleModel.findById(id).exec();
        if (!role) throw new NotFoundException('Role not found');
        return role;
    }

    async update(id: string, dto: UpdateRoleDto) {
        const role = await this.roleModel
            .findByIdAndUpdate(id, dto, { new: true })
            .exec();
        if (!role) throw new NotFoundException('Role not found');
        return role;
    }

    async remove(id: string) {
        const role = await this.findOne(id);
        if (role.isSystemRole) {
            throw new BadRequestException(
                `"${role.name}" is a built-in role and cannot be deleted`,
            );
        }
        await this.roleModel.deleteOne({ _id: id }).exec();
        return { deleted: true };
    }
}