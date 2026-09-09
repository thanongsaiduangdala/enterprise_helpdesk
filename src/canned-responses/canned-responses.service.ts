import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CannedResponse, CannedResponseDocument } from './schemas/canned-response.schema';
import { CreateCannedResponseDto } from './dto/create-canned-response.dto';
import { UpdateCannedResponseDto } from './dto/update-canned-response.dto';
import { UsersService } from '../users/users.service';

@Injectable()
export class CannedResponsesService {
    constructor(
        @InjectModel(CannedResponse.name) private responseModel: Model<CannedResponseDocument>,
        private usersService: UsersService,
    ) { }

    private async generateId(): Promise<string> {
        const responses = await this.responseModel
            .find({ _id: /^CR\d{3}$/ }, { _id: 1 })
            .sort({ _id: 1 })
            .exec();
        const usedNumbers = new Set(responses.map((r) => parseInt(r._id.slice(2), 10)));
        let seq = 1;
        while (usedNumbers.has(seq)) seq++;
        return `CR${String(seq).padStart(3, '0')}`;
    }

    private async assertCanManage(response: CannedResponseDocument, userId: string, permissions: any[]) {
        const hasElevatedAccess = (permissions ?? []).some(
            (p) => p.module === 'tickets' && p.actions.includes('assign'),
        );
        if (hasElevatedAccess) return;

        const user = await this.usersService.findOne(userId);
        if (user.departmentId !== response.departmentId) {
            throw new ForbiddenException('You can only manage canned responses for your own department');
        }
    }

    async create(dto: CreateCannedResponseDto, createdBy: string) {
        const existing = await this.responseModel.findOne({
            departmentId: dto.departmentId,
            title: dto.title,
        });
        if (existing) {
            throw new ConflictException(`A canned response titled "${dto.title}" already exists in this department`);
        }
        const _id = await this.generateId();
        return new this.responseModel({ _id, ...dto, createdBy }).save();
    }

    findAll(departmentId?: string) {
        const filter = departmentId ? { departmentId } : {};
        return this.responseModel.find(filter).sort({ title: 1 }).exec();
    }

    async findOne(id: string) {
        const response = await this.responseModel.findById(id).exec();
        if (!response) throw new NotFoundException('Canned response not found');
        return response;
    }

    async update(id: string, dto: UpdateCannedResponseDto, userId: string, permissions: any[]) {
        const response = await this.findOne(id);
        await this.assertCanManage(response, userId, permissions);

        const updated = await this.responseModel.findByIdAndUpdate(id, dto, { new: true }).exec();
        if (!updated) throw new NotFoundException('Canned response not found');
        return updated;
    }

    async remove(id: string, userId: string, permissions: any[]) {
        const response = await this.findOne(id);
        await this.assertCanManage(response, userId, permissions);

        await this.responseModel.deleteOne({ _id: id }).exec();
        return { deleted: true };
    }
}