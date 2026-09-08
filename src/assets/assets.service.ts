import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset, AssetDocument, AssetStatus } from './schemas/asset.schema';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { AssignAssetDto } from './dto/assign-asset.dto';
import { ReturnAssetDto } from './dto/return-asset.dto';

@Injectable()
export class AssetsService {
    constructor(
        @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
    ) { }


    private async generateId(): Promise<string> {
        const assets = await this.assetModel
            .find({ _id: /^AS\d{3}$/ }, { _id: 1 })
            .sort({ _id: 1 })
            .exec();
        const usedNumbers = new Set(assets.map((a) => parseInt(a._id.slice(2), 10)));
        let seq = 1;
        while (usedNumbers.has(seq)) seq++;
        return `AS${String(seq).padStart(3, '0')}`;
    }

    async create(dto: CreateAssetDto) {
        const existing = await this.assetModel.findOne({ assetTag: dto.assetTag });
        if (existing) {
            throw new ConflictException(`Asset tag "${dto.assetTag}" is already in use`);
        }
        const _id = await this.generateId();
        return new this.assetModel({ _id, ...dto }).save();
    }


    findAll(filters: { branchId?: string; status?: AssetStatus; assigneeId?: string }) {
        const query: any = {};
        if (filters.branchId) query.branchId = filters.branchId;
        if (filters.status) query.status = filters.status;
        if (filters.assigneeId) query.currentAssigneeId = filters.assigneeId;
        return this.assetModel.find(query).exec();
    }

    async findOne(id: string) {
        const asset = await this.assetModel.findById(id).exec();
        if (!asset) throw new NotFoundException('Asset not found');
        return asset;
    }



    async update(id: string, dto: UpdateAssetDto) {
        const asset = await this.assetModel.findByIdAndUpdate(id, dto, { new: true }).exec();
        if (!asset) throw new NotFoundException('Asset not found');
        return asset;
    }




    async assign(id: string, dto: AssignAssetDto) {
        const asset = await this.findOne(id);
        if (asset.status === AssetStatus.RETIRED) {
            throw new BadRequestException('Cannot assign a retired asset');
        }

        const now = new Date();
        const openEntry = asset.assignmentHistory.find((h) => !h.returnedAt);
        if (openEntry) {
            openEntry.returnedAt = now;
        }

        asset.assignmentHistory.push({
            assigneeId: dto.assigneeId as any,
            assignedAt: now,
            note: dto.note,
        });
        asset.currentAssigneeId = dto.assigneeId as any;
        asset.status = AssetStatus.ASSIGNED;
        return asset.save();
    }



    async returnAsset(id: string, dto: ReturnAssetDto) {
        const asset = await this.findOne(id);
        if (asset.status !== AssetStatus.ASSIGNED) {
            throw new BadRequestException('This asset is not currently assigned');
        }
        const openEntry = asset.assignmentHistory.find((h) => !h.returnedAt);
        if (openEntry) {
            openEntry.returnedAt = new Date();
            if (dto.note) openEntry.note = dto.note;
        }
        asset.currentAssigneeId = undefined;
        asset.status = AssetStatus.AVAILABLE;
        return asset.save();
    }




    async setStatus(id: string, status: 'AVAILABLE' | 'UNDER_REPAIR' | 'RETIRED') {
        const asset = await this.findOne(id);
        if (asset.status === AssetStatus.ASSIGNED) {
            const openEntry = asset.assignmentHistory.find((h) => !h.returnedAt);
            if (openEntry) openEntry.returnedAt = new Date();
            asset.currentAssigneeId = undefined;
        }
        asset.status = status as AssetStatus;
        return asset.save();
    }

    async remove(id: string) {
        const result = await this.assetModel.findByIdAndDelete(id).exec();
        if (!result) throw new NotFoundException('Asset not found');
        return { deleted: true };
    }






    async findOverdueReturns() {
        return this.assetModel.aggregate([
            { $match: { status: AssetStatus.ASSIGNED, currentAssigneeId: { $exists: true } } },
            {
                $lookup: {
                    from: 'users',
                    localField: 'currentAssigneeId',
                    foreignField: '_id',
                    as: 'assignee',
                },
            },
            { $unwind: '$assignee' },
            { $match: { 'assignee.isActive': false } },
            {
                $project: {
                    assetTag: 1,
                    type: 1,
                    branchId: 1,
                    currentAssigneeId: 1,
                    'assignee.email': 1,
                    'assignee.isActive': 1,
                },
            },
        ]);
    }
}
