import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { parse } from 'csv-parse/sync';
import { Asset, AssetDocument, AssetStatus } from './schemas/asset.schema';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { AssignAssetDto } from './dto/assign-asset.dto';
import { ReturnAssetDto } from './dto/return-asset.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { MaintenanceHistoryService } from '../maintenance-history/maintenance-history.service';
import { MaintenanceStatus } from '../maintenance-history/schemas/maintenance-history.schema';
import { SupplyCatalogService } from '../supply-catalog/supply-catalog.service';

@Injectable()
export class AssetsService {
    constructor(
        @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
        private auditLogsService: AuditLogsService,
        private maintenanceHistoryService: MaintenanceHistoryService,
        private catalogService: SupplyCatalogService,
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
        const { assetTag, catalogItemId, ...rest } = dto;

        // ຜູກກັບລາຍການ catalog (ຕ້ອງມີຈິງ)
        if (catalogItemId) {
            await this.catalogService.findOne(catalogItemId);
        }

        // ຖ້າບໍ່ມີ Asset Tag → ສ້າງໃຫ້ອັດຕະໂນມັດຈາກ code ຂອງ catalog item (ຕົວຢ່າງ: SC002-001)
        let tag = assetTag;
        if (!tag) {
            if (!catalogItemId) {
                throw new BadRequestException(
                    'Provide an assetTag or select a catalog item so the system can auto-generate one (e.g. SC002-001)',
                );
            }
            tag = await this.generateCatalogAssetTag(catalogItemId);
        }

        const existing = await this.assetModel.findOne({ assetTag: tag });
        if (existing) {
            throw new ConflictException(`Asset tag "${tag}" is already in use`);
        }
        const _id = await this.generateId();
        return new this.assetModel({ _id, assetTag: tag, catalogItemId, ...rest }).save();
    }

    private async generateCatalogAssetTag(catalogItemId: string): Promise<string> {
        const escapedPrefix = catalogItemId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const prefix = `${catalogItemId}-`;
        const assets = await this.assetModel
            .find({ assetTag: new RegExp(`^${escapedPrefix}-\\d+$`, 'i') }, { assetTag: 1 })
            .sort({ assetTag: 1 })
            .exec();
        const usedNumbers = new Set(
            assets
                .map((a) => parseInt(a.assetTag.slice(prefix.length), 10))
                .filter((n) => Number.isFinite(n)),
        );
        let seq = 1;
        while (usedNumbers.has(seq)) seq++;
        return `${catalogItemId}-${String(seq).padStart(3, '0')}`;
    }

    async bulkImport(fileBuffer: Buffer) {
        let rows: Record<string, string>[];
        try {
            rows = parse(fileBuffer, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });
        } catch (err: any) {
            throw new ConflictException(`Could not parse CSV file: ${err.message}`);
        }

        const results: Array<{ row: number; reference: string; success: boolean; error?: string }> = [];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNumber = i + 2;
            try {
                if (!row.assetTag || !row.type || !row.branchId) {
                    throw new Error('Missing one or more required fields (assetTag, type, branchId)');
                }
                const dto: CreateAssetDto = {
                    assetTag: row.assetTag,
                    type: row.type,
                    branchId: row.branchId,
                    purchaseDate: row.purchaseDate || undefined,
                    warrantyExpiry: row.warrantyExpiry || undefined,
                };
                await this.create(dto);
                results.push({ row: rowNumber, reference: row.assetTag, success: true });
            } catch (error: any) {
                results.push({ row: rowNumber, reference: row.assetTag ?? '', success: false, error: error.message ?? 'Unknown error' });
            }
        }

        return {
            total: rows.length,
            created: results.filter((r) => r.success).length,
            failed: results.filter((r) => !r.success).length,
            results,
        };
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

    async findByAssetTag(assetTag: string) {
        const escaped = assetTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return this.assetModel.findOne({ assetTag: new RegExp(`^${escaped}$`, 'i') }).exec();
    }


    async update(id: string, dto: UpdateAssetDto) {
        const asset = await this.assetModel.findByIdAndUpdate(id, dto, { new: true }).exec();
        if (!asset) throw new NotFoundException('Asset not found');
        return asset;
    }



    async assign(id: string, dto: AssignAssetDto, actorId: string, ip?: string) {
        const asset = await this.findOne(id);
        return this.performAssign(asset, dto.assigneeId, dto.note, actorId, ip);
    }

    /**
     * ອ້າງສິດຮັບເຄື່ອງດ້ວຍຕົນເອງ — ຜູ້ໃຊ້ທີ່ກຳລັງ login ຮັບຊັບສິນທີ່ຍັງວ່າງ
     * (ຈາກການສະແກນ QR/ບາໂຄ໊ດ ໃນໜ້າທະບຽນຊັບສິນ) ໂດຍບໍ່ຕ້ອງມີ assets.assign
     */
    async claim(id: string, actorId: string, note?: string, ip?: string) {
        const asset = await this.findOne(id);
        if (asset.status === AssetStatus.RETIRED) {
            throw new BadRequestException('Cannot claim a retired asset');
        }
        if (asset.status !== AssetStatus.AVAILABLE) {
            throw new BadRequestException(`This asset is not available for claiming (status: ${asset.status})`);
        }
        return this.performAssign(asset, actorId, note, actorId, ip);
    }

    private async performAssign(
        asset: AssetDocument,
        assigneeId: string,
        note: string | undefined,
        actorId: string,
        ip?: string,
    ) {
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
            assigneeId: assigneeId as any,
            assignedAt: now,
            note,
        });
        asset.currentAssigneeId = assigneeId as any;
        asset.status = AssetStatus.ASSIGNED;
        const saved = await asset.save();

        await this.auditLogsService.log(
            actorId,
            wasAssigned ? 'ASSET_REASSIGNED' : 'ASSET_ASSIGNED',
            'Asset',
            asset._id,
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



    async setStatus(id: string, status: 'AVAILABLE' | 'UNDER_REPAIR' | 'RETIRED', actorId: string, ip?: string) {
        const asset = await this.findOne(id);
        const before = asset.toObject();

        if (asset.status === AssetStatus.ASSIGNED) {
            const openEntry = asset.assignmentHistory.find((h) => !h.returnedAt);
            if (openEntry) openEntry.returnedAt = new Date();
            asset.currentAssigneeId = undefined;
        }

        const previousStatus = asset.status;
        asset.status = status as AssetStatus;
        const saved = await asset.save();

        // ບັນທຶກປະຫວັດການສ້ອມແປງອັດຕະໂມມັດ: ສົ່ງເຂົ້າ -> ສ້າງບັນທຶກ IN_PROGRESS,
        // ອອກຈາກການສ້ອມແປງ -> ປິດບັນທຶກທີ່ຍັງຄ້າງຢູ່ເປັນ COMPLETED
        if (status === 'UNDER_REPAIR') {
            await this.maintenanceHistoryService.create(
                {
                    assetId: asset._id,
                    maintenanceDate: new Date().toISOString(),
                    status: MaintenanceStatus.IN_PROGRESS,
                    previousStatus,
                    newStatus: status,
                    issue: 'ໄດ້ສົ່ງເຂົ້າການສ້ອມແປງ',
                    description: `ສະຖານະຊັບສິນປ່ຽນຈາກ ${previousStatus} ເປັນ ${status}`,
                },
                actorId,
            );
        } else if (String(previousStatus) === 'UNDER_REPAIR') {
            const records = await this.maintenanceHistoryService.findByAssetId(asset._id);
            const open = records.find((r) => r.status === MaintenanceStatus.IN_PROGRESS);
            if (open) {
                await this.maintenanceHistoryService.update(String(open._id), {
                    status: MaintenanceStatus.COMPLETED,
                    completionDate: new Date().toISOString(),
                    repairNotes: 'ສ້ອມແປງສຳເລັດແລ້ວ',
                });
            }
        }

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