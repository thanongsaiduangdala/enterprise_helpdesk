import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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



    async adjustStock(id: string, delta: number) {
        const item = await this.findOne(id);
        const newQty = item.stockQty + delta;
        if (newQty < 0) {
            throw new BadRequestException(
                `Insufficient stock for "${item.name}": have ${item.stockQty}, requested ${-delta}`,
            );
        }
        item.stockQty = newQty;
        return item.save();
    }

    async remove(id: string) {
        const result = await this.catalogModel.findByIdAndDelete(id).exec();
        if (!result) throw new NotFoundException('Catalog item not found');
        return { deleted: true };
    }
}
