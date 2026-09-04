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

    // Same gap-filling pattern as the other custom-ID collections.
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

    // Filterable registry view — e.g. ?branchId=BX001&status=AVAILABLE
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

    // General field update (type, purchaseDate, warrantyExpiry, branchId...). Status
    // and assignment can't be changed through here — see assign()/returnAsset()/setStatus().
    async update(id: string, dto: UpdateAssetDto) {
        const asset = await this.assetModel.findByIdAndUpdate(id, dto, { new: true }).exec();
        if (!asset) throw new NotFoundException('Asset not found');
        return asset;
    }

    // Assigns to a new person. If the asset is already assigned to someone else,
    // that prior assignment is closed out (returnedAt set) before the new one opens —
    // this is what makes it work as "reassign" too, not just first-time assign.
    async assign(id: string, dto: AssignAssetDto) {
        const asset = await this.findOne(id);
        if (asset.status === AssetStatus.RETIRED) {
            throw new BadRequestException('Cannot assign a retired asset');
        }

        const now = new Date();
        const openEntry = asset.assignmentHistory.find((h) => !h.returnedAt);
        if (openEntry) {
            openEntry.returnedAt = now; // close out the previous holder before reassigning
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

    // Returns the asset — closes the open history entry, clears the assignee,
    // and defaults status back to AVAILABLE (use /status afterward for e.g. UNDER_REPAIR).
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

    // Admin override for Available / Under Repair / Retired — deliberately can't set
    // ASSIGNED here (see SetAssetStatusDto). Also clears any assignee, since an asset
    // under repair or retired shouldn't still show as held by someone.
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

    // "Admin: asset audit report (who has what, overdue returns)" — finds assets still
    // marked ASSIGNED where the current assignee's user record is now inactive
    // (offboarded/transferred but the physical item was never returned).
    // ASSUMES the Users collection is named 'users' — adjust the $lookup `from` field
    // if your Mongoose collection name differs.
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
