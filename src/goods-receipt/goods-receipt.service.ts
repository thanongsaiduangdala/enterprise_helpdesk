import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import {
  GoodsReceipt,
  GoodsReceiptDocument,
  GoodsReceiptMode,
} from './schemas/goods-receipt.schema';
import { NewItemDto, NewItemKind, RestockDto } from './dto/goods-receipt.dto';
import { SupplyCatalogService } from '../supply-catalog/supply-catalog.service';
import { CatalogItemType } from '../supply-catalog/schemas/supply-catalog-item.schema';
import { AssetsService } from '../assets/assets.service';
import { UsersService } from '../users/users.service';
import {
  AuditEvent,
  runInTransaction,
  TxCtx,
} from '../common/utils/transaction.util';

type ReceiveInput = {
  mode: GoodsReceiptMode;
  catalogItemId: string;
  quantity: number;
  receivedDate?: string;
  vendor?: string;
  note?: string;
  serialNumbers?: string[];
};

@Injectable()
export class GoodsReceiptService {
  constructor(
    @InjectModel(GoodsReceipt.name)
    private model: Model<GoodsReceiptDocument>,
    private catalogService: SupplyCatalogService,
    private assetsService: AssetsService,
    private usersService: UsersService,
    @InjectConnection() private connection: Connection,
  ) {}

  /** ເພີ່ມເຄື່ອງເຂົ້າສະຕັອກ: ລາຍການຕ້ອງມີໃນ catalog ແລ້ວ */
  restock(dto: RestockDto, actorId: string, ip?: string) {
    return this.receive(
      { ...dto, mode: GoodsReceiptMode.RESTOCK },
      actorId,
      ip,
    );
  }

  /** ຊື້ເຄື່ອງໃໝ່: ສ້າງລາຍການ catalog ແລ້ວຮັບເຂົ້າດ້ວຍວິທີດຽວກັນ (receive) */
  async newItem(dto: NewItemDto, actorId: string, ip?: string) {
    const name = dto.item.name.trim();
    const similar = await this.catalogService.findByName(name);
    if (similar) {
      throw new ConflictException(
        `ມີລາຍການ "${similar.name}" (${similar._id}) ໃນ Catalog ແລ້ວ — ກະລຸນາໃຊ້ປຸ່ມ "ເພີ່ມເຄື່ອງເຂົ້າສະຕັອກ" ແທນ`,
      );
    }
    return this.receive(
      {
        ...dto,
        mode: GoodsReceiptMode.NEW_ITEM,
        // ຈະສ້າງ catalog ພາຍໃນ transaction ດຽວກັນ
        catalogItemId: '',
      },
      actorId,
      ip,
      dto.item,
    );
  }

  /** ວິທີຮັບເຄື່ອງດຽວ ທີ່ທັງສອງໂໝດໃຊ້ຮ່ວມກັນ — ທຸກຢ່າງໃນ transaction ດຽວ */
  private async receive(
    input: ReceiveInput,
    actorId: string,
    ip?: string,
    newItem?: NewItemDto['item'],
  ) {
    const audits: AuditEvent[] = [];
    const saved = await runInTransaction(this.connection, async (session) => {
      audits.length = 0;
      const ctx: TxCtx = { session, audits };

      // 1) ຫາ/ສ້າງລາຍການ catalog
      let item;
      if (newItem) {
        const created = await this.catalogService.createInTx(
          {
            name: newItem.name.trim(),
            category: newItem.category.trim(),
            unit: newItem.unit.trim(),
            itemType:
              newItem.type === NewItemKind.DEVICE
                ? CatalogItemType.ASSET
                : CatalogItemType.CONSUMABLE,
            stockQty: 0,
          },
          ctx,
        );
        item = created;
        audits.push({
          actorId,
          action: 'CATALOG_CREATED',
          entityType: 'SupplyCatalogItem',
          entityId: String(created._id),
          after: created.toObject(),
          ip,
        });
      } else {
        item = await this.catalogService.findOne(input.catalogItemId, session);
        if (item.isActive === false) {
          throw new BadRequestException(
            `ລາຍການ "${item.name}" ຖືກປິດໃຊ້ງານ — ເປີດໃຊ້ກ່ອນຮັບເຄື່ອງ`,
          );
        }
      }

      // 2) ປະເພດ: ອຸປະກອນ = ມີ S/N ແລະ ເປັນຊັບສິນ; ສິ້ນເປືອງ = ປັບຕົວເລກ
      const isDevice =
        item.itemType === CatalogItemType.ASSET ||
        (!item.itemType &&
          (await this.assetsService.catalogHasAssets(String(item._id), session)));

      const serials = (input.serialNumbers ?? [])
        .map((s) => String(s ?? '').trim())
        .filter(Boolean);
      const assetIds: string[] = [];

      if (isDevice) {
        if (serials.length !== input.quantity) {
          throw new BadRequestException(
            `ຈຳນວນ Serial Number (${serials.length}) ຕ້ອງເທົ່າກັບຈຳນວນທີ່ຮັບ (${input.quantity})`,
          );
        }
        const seen = new Set<string>();
        for (const sn of serials) {
          const key = sn.toLowerCase();
          if (seen.has(key)) {
            throw new BadRequestException(
              `Serial Number "${sn}" ຊ້ຳກັນໃນລາຍການທີ່ປ້ອນ`,
            );
          }
          seen.add(key);
          const dup = await this.assetsService.findBySerialNumber(sn, session);
          if (dup) {
            throw new ConflictException(
              `Serial Number "${sn}" ມີໃນທະບຽນຊັບສິນແລ້ວ (${dup.assetTag})`,
            );
          }
        }
        const actor = await this.usersService.findOneRaw(actorId);
        for (const sn of serials) {
          // ບໍ່ໃສ່ assigneeId = ເຂົ້າຄັງ (AVAILABLE) + ສະຕ໊ອກຖືກບວກ +1 ໂດຍ service ຊັບສິນ
          const asset = await this.assetsService.createAssignedAssetInTx(
            {
              type: item.name,
              catalogItemId: String(item._id),
              branchId: actor.branchId,
              serialNumber: sn,
              purchaseDate: input.receivedDate,
              note: `ຮັບເຄື່ອງເຂົ້າຄັງ (${input.mode})`,
            },
            ctx,
            actorId,
            ip,
          );
          assetIds.push(String(asset._id));
        }
      } else {
        if (serials.length > 0) {
          throw new BadRequestException(
            'ວັດສະດຸສິ້ນເປືອງບໍ່ຕ້ອງມີ Serial Number',
          );
        }
        const before = await this.catalogService.findOne(
          String(item._id),
          session,
        );
        const after = await this.catalogService.adjustStock(
          String(item._id),
          input.quantity,
          session,
        );
        audits.push({
          actorId,
          action: 'CATALOG_STOCK_ADDED',
          entityType: 'SupplyCatalogItem',
          entityId: String(item._id),
          before: { stockQty: before.stockQty },
          after: { stockQty: after.stockQty, delta: input.quantity },
          ip,
        });
      }

      // 3) ບັນທຶກໃບຮັບ + audit
      const [doc] = await this.model.create(
        [
          {
            mode: input.mode,
            catalogItemId: String(item._id),
            itemName: item.name,
            unit: item.unit,
            quantity: input.quantity,
            receivedDate: input.receivedDate
              ? new Date(input.receivedDate)
              : new Date(),
            vendor: input.vendor?.trim() || undefined,
            note: input.note?.trim() || undefined,
            serialNumbers: serials,
            assetIds,
            createdBy: new Types.ObjectId(actorId),
          },
        ],
        { session },
      );
      audits.push({
        actorId,
        action: 'GOODS_RECEIVED',
        entityType: 'GoodsReceipt',
        entityId: String(doc._id),
        after: {
          mode: input.mode,
          catalogItemId: String(item._id),
          item: item.name,
          quantity: input.quantity,
        },
        ip,
      });
      return doc;
    });
    await this.assetsService.flushAudits(audits);
    return saved;
  }

  findAll(filters: { q?: string; mode?: GoodsReceiptMode } = {}) {
    const query: Record<string, any> = {};
    if (filters.mode) query.mode = filters.mode;
    if (filters.q?.trim()) {
      const rx = new RegExp(
        filters.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i',
      );
      query.$or = [
        { itemName: rx },
        { catalogItemId: rx },
        { vendor: rx },
        { serialNumbers: rx },
      ];
    }
    return this.model
      .find(query)
      .sort({ createdAt: -1 })
      .limit(500)
      .populate('createdBy', 'firstName lastName employeeCode')
      .exec();
  }
}
