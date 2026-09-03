import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CannedResponse, CannedResponseDocument } from './schemas/canned-response.schema';
import { CreateCannedResponseDto } from './dto/create-canned-response.dto';
import { UpdateCannedResponseDto } from './dto/update-canned-response.dto';

@Injectable()
export class CannedResponsesService {
    constructor(
        @InjectModel(CannedResponse.name) private responseModel: Model<CannedResponseDocument>,
    ) { }

    // Same gap-filling pattern as Rooms/SupplyCatalog/etc: finds the SMALLEST unused
    // number, so a deleted CR006 gets reused by the next canned response instead of skipped.
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

    // Agent's dropdown/picker when replying to a ticket — filter to their department.
    findAll(departmentId?: string) {
        const filter = departmentId ? { departmentId } : {};
        return this.responseModel.find(filter).sort({ title: 1 }).exec();
    }

    async findOne(id: string) {
        const response = await this.responseModel.findById(id).exec();
        if (!response) throw new NotFoundException('Canned response not found');
        return response;
    }

    async update(id: string, dto: UpdateCannedResponseDto) {
        const response = await this.responseModel.findByIdAndUpdate(id, dto, { new: true }).exec();
        if (!response) throw new NotFoundException('Canned response not found');
        return response;
    }

    async remove(id: string) {
        const result = await this.responseModel.findByIdAndDelete(id).exec();
        if (!result) throw new NotFoundException('Canned response not found');
        return { deleted: true };
    }
}
