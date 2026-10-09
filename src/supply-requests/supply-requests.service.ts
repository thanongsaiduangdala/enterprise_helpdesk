import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
    SupplyRequest,
    SupplyRequestDocument,
    SupplyRequestStatus,
} from './schemas/supply-request.schema';
import { CreateSupplyRequestDto } from './dto/create-supply-request.dto';
import { ReceiveSupplyRequestDto } from './dto/receive-supply-request.dto';
import { SupplyCatalogService } from '../supply-catalog/supply-catalog.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { UsersService } from '../users/users.service';
import { AssetsService } from '../assets/assets.service';
import { AssetDocument, AssetStatus } from '../assets/schemas/asset.schema';
import { hasPermission, PermissionUser } from '../common/utils/permission.util';

@Injectable()
export class SupplyRequestsService {
    constructor(
        @InjectModel(SupplyRequest.name) private requestModel: Model<SupplyRequestDocument>,
        private catalogService: SupplyCatalogService,
        private auditLogsService: AuditLogsService,
        private usersService: UsersService,
        private assetsService: AssetsService,
    ) { }

    private async generateId(): Promise<string> {
        const requests = await this.requestModel
            .find({ _id: /^SR\d{3}$/ }, { _id: 1 })
            .sort({ _id: 1 })
            .exec();
        const usedNumbers = new Set(requests.map((r) => parseInt(r._id.slice(2), 10)));
        let seq = 1;
        while (usedNumbers.has(seq)) seq++;
        return `SR${String(seq).padStart(3, '0')}`;
    }


    async create(dto: CreateSupplyRequestDto, requestedBy: string) {
        for (const item of dto.items) {
            if (item.catalogItemId) {
                await this.catalogService.findOne(item.catalogItemId);
            }
        }
        const _id = await this.generateId();
        return new this.requestModel({ _id, requestedBy, items: dto.items }).save();
    }


    findMine(userId: string) {
        return this.requestModel.find({ requestedBy: userId }).sort({ createdAt: -1 }).exec();
    }


    /**
     * `supplies.read` alone only covers a requester's own rows. Callers that
     * can approve/fulfill/manage the catalog see every request.
     */
    findAll(status?: SupplyRequestStatus, requestedBy?: string) {
        const filter: Record<string, unknown> = {};
        if (status) filter.status = status;
        if (requestedBy) filter.requestedBy = requestedBy;
        return this.requestModel.find(filter).sort({ createdAt: -1 }).exec();
    }

    async findOne(id: string, requestedBy?: string) {
        const request = await this.requestModel.findById(id).exec();
        if (!request) throw new NotFoundException('Supply request not found');
        if (requestedBy && request.requestedBy.toString() !== requestedBy) {
            throw new NotFoundException('Supply request not found');
        }
        return request;
    }


    private assertStatus(request: SupplyRequestDocument, expected: SupplyRequestStatus) {
        if (request.status !== expected) {
            throw new BadRequestException(
                `Request is "${request.status}", expected "${expected}" for this action`,
            );
        }
    }

    async approve(id: string, approverId: string, ip?: string) {
        const request = await this.findOne(id);
        this.assertStatus(request, SupplyRequestStatus.REQUESTED);
        const before = request.toObject();

        request.status = SupplyRequestStatus.APPROVED;
        request.approvedBy = approverId as any;
        request.approvedAt = new Date();
        const saved = await request.save();

        await this.auditLogsService.log(
            approverId,
            'SUPPLY_REQUEST_APPROVED',
            'SupplyRequest',
            id,
            before,
            saved.toObject(),
            ip,
        );

        return saved;
    }

    async reject(id: string, approverId: string, reason: string, ip?: string) {
        const request = await this.findOne(id);
        this.assertStatus(request, SupplyRequestStatus.REQUESTED);
        const before = request.toObject();

        request.status = SupplyRequestStatus.REJECTED;
        request.approvedBy = approverId as any;
        request.approvedAt = new Date();
        request.rejectionReason = reason;
        const saved = await request.save();

        await this.auditLogsService.log(
            approverId,
            'SUPPLY_REQUEST_REJECTED',
            'SupplyRequest',
            id,
            before,
            saved.toObject(),
            ip,
        );

        return saved;
    }



    async fulfill(id: string, fulfilledById: string, ip?: string) {
        const request = await this.findOne(id);
        this.assertStatus(request, SupplyRequestStatus.APPROVED);
        const before = request.toObject();




        const catalogLinkedItems = request.items.filter((item) => item.catalogItemId);
        const catalogItems = await Promise.all(
            catalogLinkedItems.map((item) => this.catalogService.findOne(item.catalogItemId!.toString())),
        );

        for (const item of catalogLinkedItems) {
            const catalogItem = catalogItems.find((c) => c._id === item.catalogItemId);
            if (!catalogItem || catalogItem.stockQty < item.quantity) {
                throw new BadRequestException(
                    `Insufficient stock for "${item.name}": have ${catalogItem?.stockQty ?? 0}, requested ${item.quantity}`,
                );
            }
        }


        for (const item of catalogLinkedItems) {
            await this.catalogService.adjustStock(item.catalogItemId!.toString(), -item.quantity);
        }

        request.status = SupplyRequestStatus.FULFILLED;
        request.fulfilledBy = fulfilledById as any;
        request.fulfilledAt = new Date();
        const saved = await request.save();

        await this.auditLogsService.log(
            fulfilledById, 'SUPPLY_REQUEST_FULFILLED', 'SupplyRequest', id, before, saved.toObject(), ip,
        );

        return saved;
    }




    async receive(
        id: string,
        dto: ReceiveSupplyRequestDto,
        user: PermissionUser,
        ip?: string,
    ) {
        const request = await this.findOne(id);
        this.assertStatus(request, SupplyRequestStatus.APPROVED);
        const actorId = user.userId;
        if (!actorId) {
            throw new BadRequestException('Not authenticated');
        }

        // 1. ຜູ້ຮັບເຄື່ອງ — default ແມ່ນຜູ້ທີ່ກຳລັງສະແກນ; ຖ້າໃຫ້ຄົນອື່ນ ຕ້ອງມີ assets.assign
        let assigneeId: string;
        if (dto.assigneeCode) {
            const assignee = await this.usersService.findByEmployeeCode(dto.assigneeCode);
            if (!assignee) {
                throw new BadRequestException(`Employee code "${dto.assigneeCode}" not found`);
            }
            if (assignee.isActive === false) {
                throw new BadRequestException(`Employee code "${dto.assigneeCode}" is inactive`);
            }
            assigneeId = assignee._id.toString();
            if (assigneeId !== actorId && !hasPermission(user, 'assets', 'assign')) {
                throw new ForbiddenException(
                    'Giving the equipment to another employee requires the "assets.assign" permission',
                );
            }
        } else {
            assigneeId = actorId;
        }

        // 2. ກວດ Asset Tag ກັບທະບຽນຊັບສິນ + ສະຖານະ AVAILABLE ກ່ອນ
        const tags = [...new Set(dto.assetTags.map((t) => t.trim()).filter(Boolean))];
        if (tags.length === 0) {
            throw new BadRequestException('No valid asset tags provided');
        }

        const issues: string[] = [];
        const resolved: AssetDocument[] = [];
        for (const tag of tags) {
            const asset = await this.assetsService.findByAssetTag(tag);
            if (!asset) {
                issues.push(`"${tag}": ບໍ່ພົບໃນທະບຽນຊັບສິນ`);
                continue;
            }
            if (asset.status !== AssetStatus.AVAILABLE) {
                issues.push(`"${tag}": ສະຖານະ ${asset.status} — ບໍ່ວ່າງ`);
                continue;
            }
            resolved.push(asset);
        }

        // 3. ກວດຊະນິດ ແລະ ຈຳນວນບໍ່ເກີນລາຍການທີ່ຂໍ
        const itemNames = request.items.map((i) => (i.name || '').toLowerCase()).filter(Boolean);
        if (itemNames.length > 0) {
            const matchedCount: Record<number, number> = {};
            for (const asset of resolved) {
                const t = (asset.type || '').toLowerCase();
                const idx = itemNames.findIndex((n) => n.includes(t) || t.includes(n));
                if (idx === -1) {
                    issues.push(`"${asset.assetTag}": ຊະນິດ "${asset.type}" ບໍ່ກົງກັບລາຍການທີ່ຂໍ`);
                    continue;
                }
                const allowed = request.items[idx].quantity;
                const scanned = (matchedCount[idx] = (matchedCount[idx] || 0) + 1);
                if (scanned > allowed) {
                    issues.push(
                        `"${asset.assetTag}": ເກີນຈຳນວນທີ່ຂໍສຳລັບ "${request.items[idx].name}" (ຂໍ ${allowed}, ສະແກນຮອດ ${scanned})`,
                    );
                }
            }
        }
        if (issues.length > 0) {
            throw new BadRequestException(issues.join('; '));
        }

        // 4. ມອບໝາຍເຄື່ອງແຕ່ລະອັນໃຫ້ຜູ້ຮັບ (ເຂົ້າທະບຽນຊັບສິນ: assignmentHistory + currentAssigneeId + ASSIGNED)
        const before = request.toObject();
        for (const asset of resolved) {
            await this.assetsService.assign(
                asset._id,
                { assigneeId, note: `ມາຈາກຄຳຂໍ ${id} (ຮັບເຄື່ອງທີ່ຄັງດ້ວຍການສະແກນ)` },
                actorId,
                ip,
            );
        }

        request.status = SupplyRequestStatus.FULFILLED;
        request.fulfilledBy = actorId as any;
        request.fulfilledAt = new Date();
        request.receivedBy = assigneeId as any;
        const saved = await request.save();

        await this.auditLogsService.log(
            actorId,
            'SUPPLY_REQUEST_RECEIVED',
            'SupplyRequest',
            id,
            before,
            saved.toObject(),
            ip,
        );

        return saved;
    }

    async bulkFulfill(ids: string[], fulfilledById: string, ip?: string) {
        const results: { id: string; success: boolean; error?: string }[] = [];
        for (const id of ids) {
            try {
                await this.fulfill(id, fulfilledById, ip);
                results.push({ id, success: true });
            } catch (err: any) {
                results.push({ id, success: false, error: err?.message ?? 'Unknown error' });
            }
        }
        return results;
    }
}