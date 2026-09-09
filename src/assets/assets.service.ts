import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset, AssetDocument, AssetStatus } from './schemas/asset.schema';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { AssignAssetDto } from './dto/assign-asset.dto';
import { ReturnAssetDto } from './dto/return-asset.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class AssetsService {
    constructor(
        @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
        private auditLogsService: AuditLogsService,
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

    // Not audited — registering a new asset is routine inventory intake, not a sensitive
    // action, same reasoning applied to ticket/supply-request creation.
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

    // Not audited — general field edits (type, purchaseDate, warrantyExpiry, branchId).
    async update(id: string, dto: UpdateAssetDto) {
        const asset = await this.assetModel.findByIdAndUpdate(id, dto, { new: true }).exec();
        if (!asset) throw new NotFoundException('Asset not found');
        return asset;
    }

    // "Who has what" is the whole point of asset tracking per your spec — assign/reassign
    // is the most sensitive action in this module, so it always gets logged.
    async assign(id: string, dto: AssignAssetDto, actorId: string, ip?: string) {
        const asset = await this.findOne(id);
        if (asset.status === AssetStatus.RETIRED) {
            throw new BadRequestException('Cannot assign a retired asset');
        }
        const before = asset.toObject();
        const wasAssigned = !!asset.currentAssigneeId;

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
        const saved = await asset.save();

        await this.auditLogsService.log(
            actorId,
            wasAssigned ? 'ASSET_REASSIGNED' : 'ASSET_ASSIGNED',
            'Asset',
            id,
            before,
            saved.toObject(),
            ip,
        );

        return saved;
    }

    async returnAsset(id: string, dto: ReturnAssetDto, actorId: string, ip?: string) {
        const asset = await this.findOne(id);
        if (asset.status !== AssetStatus.ASSIGNED) {
            throw new BadRequestException('This asset is not currently assigned');
        }
        const before = asset.toObject();

        const openEntry = asset.assignmentHistory.find((h) => !h.returnedAt);
        if (openEntry) {
            openEntry.returnedAt = new Date();
            if (dto.note) openEntry.note = dto.note;
        }
        asset.currentAssigneeId = undefined;
        asset.status = AssetStatus.AVAILABLE;
        const saved = await asset.save();

        await this.auditLogsService.log(
            actorId,
            'ASSET_RETURNED',
            'Asset',
            id,
            before,
            saved.toObject(),
            ip,
        );

        return saved;
    }

    // Admin override for AVAILABLE / UNDER_REPAIR / RETIRED — logged since RETIRED in
    // particular is a permanent, consequential state change worth a paper trail.
    async setStatus(id: string, status: 'AVAILABLE' | 'UNDER_REPAIR' | 'RETIRED', actorId: string, ip?: string) {
        const asset = await this.findOne(id);
        const before = asset.toObject();

        if (asset.status === AssetStatus.ASSIGNED) {
            const openEntry = asset.assignmentHistory.find((h) => !h.returnedAt);
            if (openEntry) openEntry.returnedAt = new Date();
            asset.currentAssigneeId = undefined;
        }
        asset.status = status as AssetStatus;
        const saved = await asset.save();

        await this.auditLogsService.log(
            actorId,
            'ASSET_STATUS_CHANGED',
            'Asset',
            id,
            before,
            saved.toObject(),
            ip,
        );

        return saved;
    }

    async remove(id: string, actorId: string, ip?: string) {
        const before = await this.assetModel.findById(id).exec();
        if (!before) throw new NotFoundException('Asset not found');

        const result = await this.assetModel.findByIdAndDelete(id).exec();
        if (!result) throw new NotFoundException('Asset not found');

        await this.auditLogsService.log(
            actorId,
            'ASSET_DELETED',
            'Asset',
            id,
            before.toObject(),
            undefined,
            ip,
        );

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