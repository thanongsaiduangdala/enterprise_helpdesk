import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { RolesService } from '../roles/roles.service';

@Injectable()
export class UsersService {
    constructor(
        @InjectModel(User.name) private userModel: Model<UserDocument>,
        private rolesService: RolesService,
    ) { }

    async create(dto: CreateUserDto) {
        await this.rolesService.findOne(dto.role);

        try {
            const passwordHash = await bcrypt.hash(dto.password, 10);
            const { password, ...rest } = dto;
            const user = new this.userModel({ ...rest, passwordHash });
            return user.save();
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

    async findOne(id: string) {
        const user = await this.userModel.findById(id).populate('role').exec();
        if (!user) throw new NotFoundException('User not found');
        return user;
    }

    async update(id: string, dto: UpdateUserDto) {
        if (dto.role) {
            await this.rolesService.findOne(dto.role);
        }
        const user = await this.userModel
            .findByIdAndUpdate(id, dto, { new: true })
            .populate('role')
            .exec();
        if (!user) throw new NotFoundException('User not found');
        return user;
    }

    async remove(id: string) {
        const result = await this.userModel.findByIdAndDelete(id).exec();
        if (!result) throw new NotFoundException('User not found');
        return result;
    }
}

