import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
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
import { BranchesService } from '../branches/branches.service';
import { PurchaseRequestsService } from '../purchase-requests/purchase-requests.service';
import { PurchaseRequestMode } from '../purchase-requests/schemas/purchase-request.schema';
import { Counter, CounterDocument } from '../roles/schemas/counter.schema';
import { bumpCounterTo, nextSequence } from '../common/utils/counter.util';
import {
  AuditEvent,
  runInTransaction,
  TxCtx,
} from '../common/utils/transaction.util';

type TrackingMode = 'SERIAL' | 'TAG' | 'COUNT';

type CreatedAsset = {
  _id: string;
  assetTag: string;
  serialNumber?: string;
};

type ReceiveInput = {
  mode: GoodsReceiptMode;
  catalogItemId: string;
  quantity: number;
  receivedDate?: string;
  vendor?: string;
  unitPrice?: number;
  storageRoom?: string;
  invoiceNo?: string;
  invoiceFileUrl?: string;
  invoiceFileName?: string;
  purchaseRequestId?: string;
  exceptionReason?: string;
  note?: string;
  serialNumbers?: string[];
  expectedQuantity?: number;
  countNote?: string;
  branchId?: string;
  canException?: boolean;
};

const MAX_TAG_QUANTITY = 500;
const COUNT_MISMATCH_MESSAGE =
  'ຈຳນວນບໍ່ກົງກັບໃບສົ່ງເຄື່ອງ ກະລຸນາໃສ່ໝາຍເຫດ';

@Injectable()
export class GoodsReceiptService {
  constructor(
    @InjectModel(GoodsReceipt.name)
    private model: Model<GoodsReceiptDocument>,
    private catalogService: SupplyCatalogService,
    private assetsService: AssetsService,
    private usersService: UsersService,
    private branchesService: BranchesService,
    private purchaseRequests: PurchaseRequestsService,
    @InjectModel(Counter.name) private counterModel: Model<CounterDocument>,
    @InjectConnection() private connection: Connection,
  ) {}

  /** ເພີ່ມເຄື່ອງເຂົ້າສະຕັອກ: ລາຍການຕ້ອງມີໃນ catalog ແລ້ວ */
  restock(dto: RestockDto, actorId: string, ip?: string, canException = false) {
    return this.receive(
      { ...dto, mode: GoodsReceiptMode.RESTOCK, canException },
      actorId,
      ip,
    );
  }

  /** ຊື້ເຄື່ອງໃໝ່: ສ້າງລາຍການ catalog ແລ້ວຮັບເຂົ້າດ້ວຍວິທີດຽວກັນ (receive) */
  async newItem(dto: NewItemDto, actorId: string, ip?: string, canException = false) {
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
        canException,
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
    // ການຮັບເຄື່ອງຕ້ອງອ້າງອີງໃບສະເໜີຊື້ທີ່ອະນຸມັດແລ້ວ — ຍົກເວັ້ນສະເພາະຜູ້ມີສິດພິເສດ + ເຫດຜົນ
    // (ປິດການບັງຄັບໄດ້ຊົ່ວຄາວດ້ວຍ env PURCHASE_REQUEST_REQUIRED=false ເພື່ອທົດສອບ)
    const prRequired = process.env.PURCHASE_REQUEST_REQUIRED !== 'false';
    const exceptionReason = input.exceptionReason?.trim();
    if (!input.purchaseRequestId && prRequired) {
      if (!input.canException) {
        throw new ForbiddenException(
          'ການຮັບເຄື່ອງຕ້ອງອ້າງອີງໃບສະເໜີຊື້ທີ່ອະນຸມັດແລ້ວ — ສ້າງໃບສະເໜີ ແລະລໍອະນຸມັດກ່ອນ',
        );
      }
      if (!exceptionReason || exceptionReason.length < 5) {
        throw new BadRequestException(
          'ຮັບເຄື່ອງໂດຍບໍ່ມີໃບສະເໜີ ຕ້ອງໃສ່ເຫດຜົນ (ຢ່າງໜ້ອຍ 5 ຕົວອັກສອນ)',
        );
      }
    }

    const invoiceNo = input.invoiceNo?.trim();
    if ((input.unitPrice ?? 0) > 0 && !invoiceNo) {
      throw new BadRequestException(
        'ເມື່ອໃສ່ລາຄາ ຕ້ອງໃສ່ເລກທີໃບບິນ/ໃບເກັບເງິນ',
      );
    }
    const unitPrice = input.unitPrice ?? undefined;
    const totalPrice =
      unitPrice !== undefined ? unitPrice * input.quantity : undefined;

    const countNote = input.countNote?.trim();
    if (
      input.expectedQuantity !== undefined &&
      input.expectedQuantity !== input.quantity &&
      (!countNote || countNote.length < 3)
    ) {
      throw new BadRequestException(COUNT_MISMATCH_MESSAGE);
    }

    const actor = await this.usersService.findOneRaw(actorId);
    let branchId = actor.branchId;
    if (input.branchId?.trim()) {
      branchId = input.branchId.trim();
      try {
        await this.branchesService.findOne(branchId);
      } catch {
        throw new BadRequestException('ບໍ່ພົບສາຂາທີ່ເລືອກ');
      }
    }

    const audits: AuditEvent[] = [];
    const saved = await runInTransaction(this.connection, async (session) => {
      audits.length = 0;
      const ctx: TxCtx = { session, audits };

      // 1) ຫາ/ສ້າງລາຍການ catalog
      let item;
      if (newItem) {
        const isConsumable = newItem.type === NewItemKind.CONSUMABLE;
        const created = await this.catalogService.createInTx(
          {
            name: newItem.name.trim(),
            category: newItem.category.trim(),
            unit: newItem.unit.trim(),
            itemType: isConsumable
              ? CatalogItemType.CONSUMABLE
              : CatalogItemType.ASSET,
            trackSerial: newItem.type !== NewItemKind.DEVICE_TAG,
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

      // 1.1) ຜູກກັບໃບສະເໜີ: ກວດສະຖານະ/ຈຳນວນ/ຄວາມສອດຄ່ອງຂອງລາຍການ
      const pr = input.purchaseRequestId
        ? await this.purchaseRequests.loadForReceiveInTx(
            input.purchaseRequestId,
            input.quantity,
            actorId,
            session,
          )
        : null;
      if (pr) {
        const consistent = newItem
          ? pr.mode === PurchaseRequestMode.NEW_ITEM && !pr.catalogItemId
          : pr.catalogItemId === String(item._id);
        if (!consistent) {
          throw new BadRequestException(
            `ລາຍການບໍ່ກົງກັບໃບສະເໜີ ${pr.prNo} (${pr.itemName})`,
          );
        }
      }

      // 2) ວິທີຕິດຕາມ: SERIAL (ມີ S/N), TAG (Asset Tag ຢ່າງດຽວ), COUNT (ນັບຈຳນວນ)
      const tracking = await this.trackingMode(item, session);
      const stockBefore = item.stockQty ?? 0;
      const serials = (input.serialNumbers ?? [])
        .map((s) => String(s ?? '').trim())
        .filter(Boolean);
      const assetIds: string[] = [];
      const createdAssets: CreatedAsset[] = [];
      let stockAfter = stockBefore;

      if (tracking === 'SERIAL' || tracking === 'TAG') {
        const serialFor = (index: number) =>
          tracking === 'TAG' ? undefined : serials[index];

        if (tracking === 'SERIAL') {
          // S/N ເປັນທາງເລືອກຕອນຮັບ — ຕື່ມພາຍຫຼັງໄດ້ຢູ່ທະບຽນຊັບສິນ. ຖ້າໃສ່ ຈັບຄູ່ຕາມລຳດັບ ແລະ ຕ້ອງບໍ່ເກີນຈຳນວນທີ່ຮັບ
          if (serials.length > input.quantity) {
            throw new BadRequestException(
              `ຈຳນວນ Serial Number (${serials.length}) ຕ້ອງບໍ່ເກີນຈຳນວນທີ່ຮັບ (${input.quantity})`,
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
            const dup = await this.assetsService.findBySerialNumber(
              sn,
              session,
            );
            if (dup) {
              throw new ConflictException(
                `Serial Number "${sn}" ມີໃນທະບຽນຊັບສິນແລ້ວ (${dup.assetTag})`,
              );
            }
          }
        } else {
          if (serials.length > 0) {
            throw new BadRequestException(
              'ລາຍການທີ່ຕິດ Asset Tag ບໍ່ຕ້ອງມີ Serial Number',
            );
          }
          if (input.quantity > MAX_TAG_QUANTITY) {
            throw new BadRequestException(
              `ຮັບເຂົ້າລາຍການທີ່ຕິດ Asset Tag ໄດ້ສູງສຸດ ${MAX_TAG_QUANTITY} ຊິ້ນຕໍ່ຄັ້ງ`,
            );
          }
        }

        for (let i = 0; i < input.quantity; i++) {
          // ບໍ່ໃສ່ assigneeId = ເຂົ້າຄັງ (AVAILABLE) + ສະຕ໊ອກຖືກບວກ +1 ໂດຍ service ຊັບສິນ
          const asset = await this.assetsService.createAssignedAssetInTx(
            {
              type: item.name,
              catalogItemId: String(item._id),
              branchId,
              serialNumber: serialFor(i),
              purchaseDate: input.receivedDate,
              purchasePrice: unitPrice,
              note: `ຮັບເຄື່ອງເຂົ້າຄັງ (${input.mode})`,
            },
            ctx,
            actorId,
            ip,
          );
          assetIds.push(String(asset._id));
          createdAssets.push({
            _id: String(asset._id),
            assetTag: asset.assetTag,
            serialNumber: asset.serialNumber || undefined,
          });
        }
        stockAfter = (
          await this.catalogService.findOne(String(item._id), session)
        ).stockQty;
      } else {
        if (serials.length > 0) {
          throw new BadRequestException(
            'ວັດສະດຸສິ້ນເປືອງບໍ່ຕ້ອງມີ Serial Number',
          );
        }
        const after = await this.catalogService.adjustStock(
          String(item._id),
          input.quantity,
          session,
        );
        stockAfter = after.stockQty;
        audits.push({
          actorId,
          action: 'CATALOG_STOCK_ADDED',
          entityType: 'SupplyCatalogItem',
          entityId: String(item._id),
          before: { stockQty: stockBefore },
          after: { stockQty: after.stockQty, delta: input.quantity },
          ip,
        });
      }

      // 3) ບັນທຶກໃບຮັບ + audit
      const receiptNo = await this.nextReceiptNo(session);
      const [doc] = await this.model.create(
        [
          {
            receiptNo,
            mode: input.mode,
            catalogItemId: String(item._id),
            itemName: item.name,
            unit: item.unit,
            quantity: input.quantity,
            expectedQuantity: input.expectedQuantity,
            countNote: countNote || undefined,
            stockBefore,
            stockAfter,
            branchId,
            receivedDate: input.receivedDate
              ? new Date(input.receivedDate)
              : new Date(),
            vendor: input.vendor?.trim() || undefined,
            unitPrice,
            totalPrice,
            storageRoom: input.storageRoom?.trim() || undefined,
            invoiceNo: invoiceNo || undefined,
            invoiceFileUrl: input.invoiceFileUrl || undefined,
            invoiceFileName: input.invoiceFileName?.trim() || undefined,
            purchaseRequestId: pr ? String(pr._id) : undefined,
            purchaseRequestNo: pr ? pr.prNo : undefined,
            exceptionReason: !pr ? exceptionReason || undefined : undefined,
            note: input.note?.trim() || undefined,
            serialNumbers: serials,
            assetIds,
            createdBy: new Types.ObjectId(actorId),
          },
        ],
        { session },
      );
      if (pr) {
        await this.purchaseRequests.applyReceiptInTx(
          pr,
          input.quantity,
          String(doc._id),
          String(item._id),
          session,
        );
      }
      audits.push({
        actorId,
        action: pr ? 'GOODS_RECEIVED' : 'GOODS_RECEIVED_WITHOUT_PR',
        entityType: 'GoodsReceipt',
        entityId: String(doc._id),
        after: {
          mode: input.mode,
          catalogItemId: String(item._id),
          item: item.name,
          quantity: input.quantity,
          receiptNo,
          purchaseRequestNo: pr ? pr.prNo : undefined,
          exceptionReason: !pr ? exceptionReason : undefined,
          unitPrice,
          totalPrice,
          invoiceNo: invoiceNo || undefined,
        },
        ip,
      });
      return {
        ...doc.toObject(),
        assets: createdAssets,
        stockBefore,
        stockAfter,
      };
    });
    await this.assetsService.flushAudits(audits);
    return saved;
  }

  /** ເລກທີໃບຮັບ GR-0001 — counter ແບບ monotonic (seed ຈາກເລກສູງສຸດທີ່ມີ) */
  private async nextReceiptNo(session?: any): Promise<string> {
    const last = await this.model
      .findOne({ receiptNo: /^GR-\d+$/ }, { receiptNo: 1 })
      .sort({ receiptNo: -1 })
      .session(session ?? null)
      .exec();
    const max = last?.receiptNo ? parseInt(last.receiptNo.slice(3), 10) : 0;
    if (Number.isFinite(max)) {
      await bumpCounterTo(this.counterModel, 'goodsReceipt', max, session);
    }
    const seq = await nextSequence(this.counterModel, 'goodsReceipt', session);
    return `GR-${String(seq).padStart(4, '0')}`;
  }

  /** ໃບຮັບເຄື່ອງ 1 ໃບ (ສຳລັບພິມ): ຂໍ້ມູນໃບ + ຊື່ສາຂາ + ຊັບສິນທີ່ສ້າງ + ຜູ້ບັນທຶກ */
  async findOne(id: string) {
    const doc = await this.model
      .findById(id)
      .populate('createdBy', 'firstName lastName employeeCode')
      .exec();
    if (!doc) throw new NotFoundException('ບໍ່ພົບໃບຮັບເຄື່ອງ');
    const assets = await this.assetsService.findManyByIds(doc.assetIds ?? []);
    let branchName: string | undefined;
    if (doc.branchId) {
      try {
        const b: any = await this.branchesService.findOne(doc.branchId);
        branchName = b?.name;
      } catch {
        branchName = undefined;
      }
    }
    return {
      ...doc.toObject(),
      branchName,
      assets: assets
        .map((a) => ({
          _id: String(a._id),
          assetTag: a.assetTag,
          serialNumber: a.serialNumber || undefined,
        }))
        .sort((a, b) => a.assetTag.localeCompare(b.assetTag)),
    };
  }

  private async trackingMode(
    item: { _id: any; itemType?: CatalogItemType; trackSerial?: boolean },
    session?: any,
  ): Promise<TrackingMode> {
    if (item.itemType === CatalogItemType.CONSUMABLE) return 'COUNT';
    if (item.itemType === CatalogItemType.ASSET) {
      return item.trackSerial === false ? 'TAG' : 'SERIAL';
    }
    return (await this.assetsService.catalogHasAssets(String(item._id), session))
      ? 'SERIAL'
      : 'COUNT';
  }

  async findAll(
    filters: {
      q?: string;
      mode?: GoodsReceiptMode;
      catalogItemId?: string;
    } = {},
  ) {
    const query: Record<string, any> = {};
    if (filters.mode) query.mode = filters.mode;
    if (filters.catalogItemId?.trim()) {
      query.catalogItemId = filters.catalogItemId.trim();
    }
    if (filters.q?.trim()) {
      const rx = new RegExp(
        filters.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i',
      );
      query.$or = [
        { itemName: rx },
        { catalogItemId: rx },
        { vendor: rx },
        { receiptNo: rx },
        { purchaseRequestNo: rx },
        { invoiceNo: rx },
        { storageRoom: rx },
        { serialNumbers: rx },
      ];
    }
    const receipts = await this.model
      .find(query)
      .sort({ createdAt: -1 })
      .limit(500)
      .populate('createdBy', 'firstName lastName employeeCode')
      .exec();
    const ids = receipts.flatMap((r) => r.assetIds ?? []);
    const assets = await this.assetsService.findManyByIds(ids);
    const tagById = new Map(
      assets.map((a) => [String(a._id), a.assetTag]),
    );
    return receipts.map((r) => ({
      ...r.toObject(),
      assetTags: (r.assetIds ?? [])
        .map((id) => tagById.get(String(id)))
        .filter(Boolean),
    }));
  }

  /** ການຮັບເຂົ້າຫຼ້າສຸດຕໍ່ລາຍການ catalog — ຄຳຖາມດຽວ */
  summary() {
    return this.model
      .aggregate([
        { $sort: { catalogItemId: 1, createdAt: -1 } },
        {
          $group: {
            _id: '$catalogItemId',
            mode: { $first: '$mode' },
            receivedDate: { $first: '$receivedDate' },
            quantity: { $first: '$quantity' },
          },
        },
        {
          $project: {
            _id: 0,
            catalogItemId: '$_id',
            mode: 1,
            receivedDate: 1,
            quantity: 1,
          },
        },
      ])
      .exec();
  }
}
