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
import {
  SupplyRequest,
  SupplyRequestDocument,
  SupplyRequestStatus,
  SupplyLineStatus,
} from '../supply-requests/schemas/supply-request.schema';

export type CatalogItemWithStock = Record<string, any> & {
  reservedQty: number;
  freeQty: number;
  isConsumable: boolean;
};

@Injectable()
export class SupplyCatalogService {
  constructor(
    @InjectModel(SupplyCatalogItem.name)
    private catalogModel: Model<SupplyCatalogItemDocument>,
    @InjectModel(Counter.name)
    private counterModel: Model<CounterDocument>,
    @InjectModel(Asset.name)
    private assetModel: Model<AssetDocument>,
    @InjectModel(SupplyRequest.name)
    private requestModel: Model<SupplyRequestDocument>,
  ) {}

  private async generateId(session?: ClientSession): Promise<string> {
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

  async findByName(name: string, session?: ClientSession) {
    return this.catalogModel
      .findOne({ name: this.nameRegex(name) })
      .session(session ?? null)
      .exec();
  }

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

  private async reservedByCatalog(): Promise<{
    assets: Map<string, number>;
    consumables: Map<string, number>;
  }> {
    const [assetRows, consumableRows] = await Promise.all([
      this.assetModel
        .aggregate([
          {
            $match: {
              status: AssetStatus.AVAILABLE,
              reservedForRequestId: { $exists: true, $ne: null },
              catalogItemId: { $exists: true, $ne: null },
            },
          },
          { $group: { _id: '$catalogItemId', qty: { $sum: 1 } } },
        ])
        .exec(),
      this.requestModel
        .aggregate([
          {
            $match: {
              status: {
                $in: [
                  SupplyRequestStatus.APPROVED,
                  SupplyRequestStatus.ORDERED,
                  SupplyRequestStatus.PARTIALLY_RECEIVED,
                ],
              },
            },
          },
          { $unwind: '$items' },
          {
            $match: {
              'items.lineStatus': SupplyLineStatus.READY,
              'items.catalogItemId': { $exists: true, $ne: null },
            },
          },
          { $group: { _id: '$items.catalogItemId', qty: { $sum: '$items.quantity' } } },
        ])
        .exec(),
    ]);
    return {
      assets: new Map(assetRows.map((r: any) => [String(r._id), r.qty as number])),
      consumables: new Map(
        consumableRows.map((r: any) => [String(r._id), r.qty as number]),
      ),
    };
  }

  async findAll(lowStockOnly = false): Promise<CatalogItemWithStock[]> {
    const filter = lowStockOnly
      ? { $expr: { $lte: ['$stockQty', '$lowStockThreshold'] } }
      : {};
    const [items, reserved] = await Promise.all([
      this.catalogModel.find(filter).exec(),
      this.reservedByCatalog(),
    ]);
    return items.map((doc) => {
      const obj = doc.toObject();
      const isConsumable = obj.itemType === CatalogItemType.CONSUMABLE;
      const reservedQty =
        (isConsumable ? reserved.consumables : reserved.assets).get(
          String(obj._id),
        ) ?? 0;
      return {
        ...obj,
        reservedQty,
        freeQty: Math.max((obj.stockQty ?? 0) - reservedQty, 0),
        isConsumable,
      };
    });
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
    const current = await this.findOne(id);
    const changingType =
      patch.itemType !== undefined && patch.itemType !== current.itemType;
    const changingTrack =
      patch.trackSerial !== undefined &&
      (current.trackSerial ?? true) !== patch.trackSerial;
    if ((changingType || changingTrack) && current.itemType) {
      const hasAssets = await this.assetModel
        .exists({ catalogItemId: id, status: { $ne: AssetStatus.RETIRED } })
        .exec();
      if (hasAssets || current.stockQty > 0) {
        throw new ConflictException(
          `ລາຍການ "${current.name}" ມີຊັບສິນ ຫຼື ສະຕັອກແລ້ວ — ປ່ຽນວິທີຕິດຕາມບໍ່ໄດ້`,
        );
      }
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
          ...(row.trackSerial !== undefined && row.trackSerial !== ''
            ? {
                trackSerial:
                  String(row.trackSerial).toLowerCase() === 'true' ||
                  String(row.trackSerial) === '1',
              }
            : {}),
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
      const item = await this.findOne(id);
      throw new BadRequestException(
        `Insufficient stock for "${item.name}": have ${item.stockQty}, requested ${-delta}`,
      );
    }
    return updated;
  }

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
