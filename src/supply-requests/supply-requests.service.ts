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

@Injectable()
export class SupplyRequestsService {
    constructor(
        @InjectModel(SupplyRequest.name) private requestModel: Model<SupplyRequestDocument>,
        private catalogService: SupplyCatalogService,
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

    // "My requests" history view.
    findMine(userId: string) {
        return this.requestModel.find({ requestedBy: userId }).sort({ createdAt: -1 }).exec();
    }

    // Manager/admin queue view, optionally filtered by status (e.g. ?status=REQUESTED for pending approvals).
    findAll(status?: SupplyRequestStatus) {
        const filter = status ? { status } : {};
        return this.requestModel.find(filter).sort({ createdAt: -1 }).exec();
    }

    async findOne(id: string) {
        const request = await this.requestModel.findById(id).exec();
        if (!request) throw new NotFoundException('Supply request not found');
        return request;
    }

    // Status stepper: Requested -> Approved/Rejected -> Fulfilled.
    private assertStatus(request: SupplyRequestDocument, expected: SupplyRequestStatus) {
        if (request.status !== expected) {
            throw new BadRequestException(
                `Request is "${request.status}", expected "${expected}" for this action`,
            );
        }
    }

    async approve(id: string, approverId: string) {
        const request = await this.findOne(id);
        this.assertStatus(request, SupplyRequestStatus.REQUESTED);
        request.status = SupplyRequestStatus.APPROVED;
        request.approvedBy = approverId as any;
        request.approvedAt = new Date();
        return request.save();
    }

    async reject(id: string, approverId: string, reason: string) {
        const request = await this.findOne(id);
        this.assertStatus(request, SupplyRequestStatus.REQUESTED);
        request.status = SupplyRequestStatus.REJECTED;
        request.approvedBy = approverId as any;
        request.approvedAt = new Date();
        request.rejectionReason = reason;
        return request.save();
    }

    // Deducts stock for every catalog-linked item, then marks FULFILLED.
    // Free-text "other" items (no catalogItemId) are skipped — nothing to deduct.
    async fulfill(id: string, fulfilledById: string) {
        const request = await this.findOne(id);
        this.assertStatus(request, SupplyRequestStatus.APPROVED);

        for (const item of request.items) {
            if (item.catalogItemId) {
                // If any single item lacks stock, adjustStock throws and the whole
                // fulfillment aborts before status flips — nothing is partially deducted
                // since we haven't saved the request yet.
                await this.catalogService.adjustStock(item.catalogItemId.toString(), -item.quantity);
            }
        }

        request.status = SupplyRequestStatus.FULFILLED;
        request.fulfilledBy = fulfilledById as any;
        request.fulfilledAt = new Date();
        return request.save();
    }

    // "Admin: ... bulk fulfillment" — fulfills each id independently and reports
    // per-id success/failure rather than failing the whole batch on one bad request.
    async bulkFulfill(ids: string[], fulfilledById: string) {
        const results: { id: string; success: boolean; error?: string }[] = [];
        for (const id of ids) {
            try {
                await this.fulfill(id, fulfilledById);
                results.push({ id, success: true });
            } catch (err: any) {
                results.push({ id, success: false, error: err?.message ?? 'Unknown error' });
            }
        }
        return results;
    }
}
