import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
    SupplyRequest,
    SupplyRequestDocument,
    SupplyRequestStatus,
} from './schemas/supply-request.schema';
import { CreateSupplyRequestDto } from './dto/create-supply-request.dto';
import { SupplyCatalogService } from '../supply-catalog/supply-catalog.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class SupplyRequestsService {
    constructor(
        @InjectModel(SupplyRequest.name) private requestModel: Model<SupplyRequestDocument>,
        private catalogService: SupplyCatalogService,
        private auditLogsService: AuditLogsService,
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


    findAll(status?: SupplyRequestStatus) {
        const filter = status ? { status } : {};
        return this.requestModel.find(filter).sort({ createdAt: -1 }).exec();
    }

    async findOne(id: string) {
        const request = await this.requestModel.findById(id).exec();
        if (!request) throw new NotFoundException('Supply request not found');
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