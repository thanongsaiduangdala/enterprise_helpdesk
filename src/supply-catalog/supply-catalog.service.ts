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
  CatalogItemType,
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

  /** regex ຈັບຊື່ແບບ exact ແຕ່ບໍ່ສົນຕົວພິມນ້ອຍ-ໃຫຍ່ ("Mouse" = "mouse") */
  private nameRegex(name: string) {
    const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped}$`, 'i');
  }

  private async assertNameFree(name: string, exceptId?: string) {
    const existing = await this.catalogModel
      .findOne({ name: this.nameRegex(name) })
      .exec();
    if (existing && existing._id !== exceptId) {
      throw new ConflictException(
        `Catalog item "${existing.name}" already exists (${existing._id})`,
      );
    }
  }

  async create(dto: CreateSupplyCatalogItemDto) {
    const name = dto.name.trim();
    await this.assertNameFree(name);
    const _id = await this.generateId();
    // ຊັບສິນ (ASSET): ສະຕ໊ອກນັບຈາກຈຳນວນຊັບສິນວ່າງ — ບໍ່ຮັບຄ່າຈາກຜູ້ໃຊ້
    const payload = {
      ...dto,
      name,
      ...(dto.itemType === CatalogItemType.ASSET ? { stockQty: 0 } : {}),
    };
    try {
      return await new this.catalogModel({ _id, ...payload }).save();
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new ConflictException(`Catalog item "${name}" already exists`);
      }
      throw err;
    }
  }

  /** ຫາລາຍການ catalog ດ້ວຍຊື່ (ບໍ່ສົນຕົວພິມນ້ອຍ-ໃຫຍ່) */
  async findByName(name: string, session?: ClientSession) {
    return this.catalogModel
      .findOne({ name: this.nameRegex(name) })
      .session(session ?? null)
      .exec();
  }

  /**
   * ສ້າງລາຍການ catalog ພາຍໃນ transaction ຂອງ service ອື່ນ (ເຊັ່ນ ຮັບເຄື່ອງເຂົ້າຄັງ).
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
          .findOne({ name: this.nameRegex(name) })
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
    const patch = { ...dto };
    if (patch.name !== undefined) {
      patch.name = patch.name.trim();
      await this.assertNameFree(patch.name, id);
    }
    try {
      const item = await this.catalogModel
        .findByIdAndUpdate(id, patch, { new: true })
        .exec();
      if (!item) throw new NotFoundException('Catalog item not found');
      return item;
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new ConflictException(
          `Catalog item "${patch.name}" already exists`,
        );
      }
      throw err;
    }
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
        let itemType: CatalogItemType | undefined;
        if (row.itemType !== undefined && row.itemType !== '') {
          const v = String(row.itemType).trim().toUpperCase();
          if (v !== 'ASSET' && v !== 'CONSUMABLE') {
            throw new Error(
              `Invalid itemType "${row.itemType}" (ຕ້ອງເປັນ ASSET ຫຼື CONSUMABLE)`,
            );
          }
          itemType = v as CatalogItemType;
        }
        const dto: CreateSupplyCatalogItemDto = {
          name: row.name,
          category: row.category,
          unit: row.unit,
          ...(itemType ? { itemType } : {}),
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
   * ຄຳນວນສະຕ໊ອກໃໝ່ຂອງລາຍການທີ່ມີຊັບສິນ: ສະຕ໊ອກ = ຈຳນວນຊັບສິນ AVAILABLE.
   * ແກ້ຕົວເລກທີ່ເພີ້ຍ (ເຊັ່ນ ລົງທະບຽນຊັບສິນວ່າງແຕ່ສະຕ໊ອກບໍ່ຂຶ້ນ).
   * ຄືນສະເພາະລາຍການທີ່ຕົວເລກປ່ຽນ.
   */
  async recalculateAssetStock() {
    const ids: string[] = (
      await this.assetModel.distinct('catalogItemId')
    ).filter(Boolean);
    const changes: {
      _id: string;
      name: string;
      before: number;
      after: number;
    }[] = [];
    for (const id of ids) {
      const item = await this.catalogModel.findById(id).exec();
      if (!item) continue;
      const available = await this.assetModel
        .countDocuments({ catalogItemId: id, status: AssetStatus.AVAILABLE })
        .exec();
      if (item.stockQty !== available) {
        await this.catalogModel
          .updateOne({ _id: id }, { $set: { stockQty: available } })
          .exec();
        changes.push({
          _id: id,
          name: item.name,
          before: item.stockQty,
          after: available,
        });
      }
    }
    return { checked: ids.length, changed: changes.length, changes };
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
