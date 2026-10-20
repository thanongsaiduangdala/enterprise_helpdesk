import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { parse } from 'csv-parse/sync';
import {
  SupplyCatalogItem,
  SupplyCatalogItemDocument,
} from './schemas/supply-catalog-item.schema';
import { CreateSupplyCatalogItemDto } from './dto/create-supply-catalog-item.dto';
import { UpdateSupplyCatalogItemDto } from './dto/update-supply-catalog-item.dto';
import { TxCtx } from '../common/utils/transaction.util';
import { bumpCounterTo, nextSequence } from '../common/utils/counter.util';
import { Counter, CounterDocument } from '../roles/schemas/counter.schema';
import {
  Asset,
  AssetDocument,
  AssetStatus,
} from '../assets/schemas/asset.schema';

@Injectable()
export class SupplyCatalogService {
  constructor(
    @InjectModel(SupplyCatalogItem.name)
    private catalogModel: Model<SupplyCatalogItemDocument>,
    @InjectModel(Counter.name)
    private counterModel: Model<CounterDocument>,
    @InjectModel(Asset.name)
    private assetModel: Model<AssetDocument>,
  ) {}

  private async generateId(session?: ClientSession): Promise<string> {
    // seed ຈາກເລກສູງສຸດທີ່ມີຢູ່ (ຂໍ້ມູນເກົ່າ) ແລ້ວອອກເລກແບບ monotonic
    const last = await this.catalogModel
      .findOne({ _id: /^SC\d{3}$/ }, { _id: 1 })
      .sort({ _id: -1 })
      .session(session ?? null)
      .exec();
    const maxSeq = last ? parseInt(last._id.slice(2), 10) : 0;
    if (Number.isFinite(maxSeq)) {
      await bumpCounterTo(this.counterModel, 'supplyCatalog', maxSeq, session);
    }
    const seq = await nextSequence(this.counterModel, 'supplyCatalog', session);
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

  /** ຫາລາຍການ catalog ດ້ວຍຊື່ແບບ exact (ໃຊ້ຈາກ POPR ຕອນປິດເພື່ອຜູກ ຫຼື ສ້າງໃໝ່) */
  async findByName(name: string, session?: ClientSession) {
    return this.catalogModel
      .findOne({ name })
      .session(session ?? null)
      .exec();
  }

  /**
   * ສ້າງລາຍການ catalog ພາຍໃນ transaction ຂອງ service ອື່ນ (ເຊັ່ນ POPR).
   * ຖ້າຊື່ຊ້ຳ (race) → ຄືນລາຍການທີ່ມີຢູ່ແລ້ວ. ຜູ້ເອີ້ນເປັນຜູ້ push audit ເອງ.
   */
  async createInTx(dto: CreateSupplyCatalogItemDto, ctx: TxCtx) {
    const name = dto.name.trim();
    const _id = await this.generateId(ctx.session);
    try {
      return await new this.catalogModel({ _id, ...dto, name }).save({
        session: ctx.session,
      });
    } catch (err: any) {
      if (err?.code === 11000) {
        const existing = await this.catalogModel
          .findOne({ name })
          .session(ctx.session ?? null)
          .exec();
        if (existing) return existing;
      }
      throw err;
    }
  }

  findAll(lowStockOnly = false) {
    if (lowStockOnly) {
      return this.catalogModel
        .find({ $expr: { $lte: ['$stockQty', '$lowStockThreshold'] } })
        .exec();
    }
    return this.catalogModel.find().exec();
  }

  async findOne(id: string, session?: ClientSession) {
    const item = await this.catalogModel
      .findById(id)
      .session(session ?? null)
      .exec();
    if (!item) throw new NotFoundException('Catalog item not found');
    return item;
  }

  async update(id: string, dto: UpdateSupplyCatalogItemDto) {
    const item = await this.catalogModel
      .findByIdAndUpdate(id, dto, { new: true })
      .exec();
    if (!item) throw new NotFoundException('Catalog item not found');
    return item;
  }

  async bulkImport(fileBuffer: Buffer) {
    let rows: Record<string, string>[];
    try {
      rows = parse(fileBuffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      });
    } catch (err: any) {
      throw new ConflictException(`Could not parse CSV file: ${err.message}`);
    }

    const results: Array<{
      row: number;
      reference: string;
      success: boolean;
      error?: string;
    }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2;
      try {
        if (!row.name || !row.category || !row.unit) {
          throw new Error(
            'Missing one or more required fields (name, category, unit)',
          );
        }
        const dto: CreateSupplyCatalogItemDto = {
          name: row.name,
          category: row.category,
          unit: row.unit,
          stockQty:
            row.stockQty !== undefined && row.stockQty !== ''
              ? parseInt(row.stockQty, 10)
              : undefined,
          lowStockThreshold:
            row.lowStockThreshold !== undefined && row.lowStockThreshold !== ''
              ? parseInt(row.lowStockThreshold, 10)
              : undefined,
          isActive:
            row.isActive !== undefined && row.isActive !== ''
              ? String(row.isActive).toLowerCase() === 'true'
              : undefined,
        };
        await this.create(dto);
        results.push({ row: rowNumber, reference: row.name, success: true });
      } catch (error: any) {
        results.push({
          row: rowNumber,
          reference: row.name ?? '',
          success: false,
          error: error.message ?? 'Unknown error',
        });
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
    const filter =
      delta < 0 ? { _id: id, stockQty: { $gte: -delta } } : { _id: id };
    const updated = await this.catalogModel
      .findOneAndUpdate(
        filter,
        { $inc: { stockQty: delta } },
        { new: true, session },
      )
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
    const item = await this.catalogModel
      .findById(id)
      .session(session ?? null)
      .exec();
    if (!item)
      return { applied: 0, mismatch: 0, stockBefore: 0, stockAfter: 0 };
    const applied = delta < 0 ? -Math.min(-delta, item.stockQty) : delta;
    if (applied !== 0) {
      await this.catalogModel
        .updateOne({ _id: id }, { $inc: { stockQty: applied } }, { session })
        .exec();
    }
    return {
      applied,
      mismatch: delta - applied,
      stockBefore: item.stockQty,
      stockAfter: item.stockQty + applied,
    };
  }

  /**
   * ປິດໃຊ້ງານ (soft-disable) ແທນການລຶບຖາວອນ — ບໍ່ລຶບ ຖ້າຍັງມີຊັບສິນອ້າງອີງລາຍການນີ້
   * (ເພື່ອປ້ອງກັນ orphan asset) ແລະ ຮັກສາ audit/ປະຫວັດໄວ້.
   */
  async remove(id: string) {
    const item = await this.catalogModel.findById(id).exec();
    if (!item) throw new NotFoundException('Catalog item not found');
    const referenced = await this.assetModel
      .exists({ catalogItemId: id, status: { $ne: AssetStatus.RETIRED } })
      .exec();
    if (referenced) {
      throw new BadRequestException(
        `Catalog item "${item.name}" has assets linked to it and cannot be removed — disable it instead`,
      );
    }
    if (item.isActive) {
      await this.catalogModel
        .updateOne({ _id: id }, { isActive: false })
        .exec();
    }
    return { deleted: false, disabled: true, _id: id };
  }
}
