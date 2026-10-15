import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { parse } from 'csv-parse/sync';
import { SupplyCatalogItem, SupplyCatalogItemDocument } from './schemas/supply-catalog-item.schema';
import { CreateSupplyCatalogItemDto } from './dto/create-supply-catalog-item.dto';
import { UpdateSupplyCatalogItemDto } from './dto/update-supply-catalog-item.dto';

@Injectable()
export class SupplyCatalogService {
    constructor(
        @InjectModel(SupplyCatalogItem.name)
        private catalogModel: Model<SupplyCatalogItemDocument>,
    ) { }


    private async generateId(): Promise<string> {
        const items = await this.catalogModel
            .find({ _id: /^SC\d{3}$/ }, { _id: 1 })
            .sort({ _id: 1 })
            .exec();
        const usedNumbers = new Set(items.map((i) => parseInt(i._id.slice(2), 10)));
        let seq = 1;
        while (usedNumbers.has(seq)) seq++;
        return `SC${String(seq).padStart(3, '0')}`;
    }

    async create(dto: CreateSupplyCatalogItemDto) {
        const existing = await this.catalogModel.findOne({ name: dto.name });
        if (existing) {
            throw new ConflictException(`Catalog item "${dto.name}" already exists`);
        }
        const _id = await this.generateId();
        return new this.catalogModel({ _id, ...dto }).save();
    }



    findAll(lowStockOnly = false) {
        if (lowStockOnly) {
            return this.catalogModel
                .find({ $expr: { $lte: ['$stockQty', '$lowStockThreshold'] } })
                .exec();
        }
        return this.catalogModel.find().exec();
    }

    async findOne(id: string) {
        const item = await this.catalogModel.findById(id).exec();
        if (!item) throw new NotFoundException('Catalog item not found');
        return item;
    }

    async update(id: string, dto: UpdateSupplyCatalogItemDto) {
        const item = await this.catalogModel.findByIdAndUpdate(id, dto, { new: true }).exec();
        if (!item) throw new NotFoundException('Catalog item not found');
        return item;
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
                if (!row.name || !row.category || !row.unit) {
                    throw new Error('Missing one or more required fields (name, category, unit)');
                }
                const dto: CreateSupplyCatalogItemDto = {
                    name: row.name,
                    category: row.category,
                    unit: row.unit,
                    stockQty: row.stockQty !== undefined && row.stockQty !== '' ? parseInt(row.stockQty, 10) : undefined,
                    lowStockThreshold: row.lowStockThreshold !== undefined && row.lowStockThreshold !== '' ? parseInt(row.lowStockThreshold, 10) : undefined,
                    isActive: row.isActive !== undefined && row.isActive !== '' ? String(row.isActive).toLowerCase() === 'true' : undefined,
                };
                await this.create(dto);
                results.push({ row: rowNumber, reference: row.name, success: true });
            } catch (error: any) {
                results.push({ row: rowNumber, reference: row.name ?? '', success: false, error: error.message ?? 'Unknown error' });
            }
        }

        return {
            total: rows.length,
            created: results.filter((r) => r.success).length,
            failed: results.filter((r) => !r.success).length,
            results,
        };
    }



    /** ປັບສະຕ໊ອກແບບ atomic (ເງື່ອນໄຂ + $inc ໃນຄຳສັ່ງດຽວ) — ບໍ່ໃຫ້ຕ່ຳກວ່າ 0 ແລະບໍ່ມີ race condition */
    async adjustStock(id: string, delta: number, session?: ClientSession) {
        const filter = delta < 0 ? { _id: id, stockQty: { $gte: -delta } } : { _id: id };
        const updated = await this.catalogModel
            .findOneAndUpdate(filter, { $inc: { stockQty: delta } }, { new: true, session })
            .exec();
        if (!updated) {
            const item = await this.findOne(id); // NotFound ຖ້າບໍ່ມີ
            throw new BadRequestException(
                `Insufficient stock for "${item.name}": have ${item.stockQty}, requested ${-delta}`,
            );
        }
        return updated;
    }

    /**
     * ປັບສະຕ໊ອກຕາມການເຄື່ອນໄຫວຂອງຊັບສິນ (ມອບ/ຄືນ/ສ້ອມ/ປົດ) — ບໍ່ຕັນການເຮັດວຽກ ຖ້າສະຕ໊ອກບໍ່ຕົງ:
     * ຕັດໄດ້ເທົ່າທີ່ມີ (ບໍ່ຕ່ຳກວ່າ 0) ແລ້ວຄືນ mismatch = ຈຳນວນທີ່ຕັດບໍ່ໄດ້ ເພື່ອໃຫ້ຜູ້ເອີ້ນບັນທຶກ audit
     */
    async adjustStockTracked(id: string, delta: number, session?: ClientSession) {
        const item = await this.catalogModel.findById(id).session(session ?? null).exec();
        if (!item) return { applied: 0, mismatch: 0, stockBefore: 0, stockAfter: 0 };
        const applied = delta < 0 ? -Math.min(-delta, item.stockQty) : delta;
        if (applied !== 0) {
            await this.catalogModel.updateOne({ _id: id }, { $inc: { stockQty: applied } }, { session }).exec();
        }
        return { applied, mismatch: delta - applied, stockBefore: item.stockQty, stockAfter: item.stockQty + applied };
    }

    async remove(id: string) {
        const result = await this.catalogModel.findByIdAndDelete(id).exec();
        if (!result) throw new NotFoundException('Catalog item not found');
        return { deleted: true };
    }
}
