import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  PurchaseRequest,
  PurchaseRequestDocument,
  PurchaseRequestMode,
  PurchaseRequestStatus,
} from './schemas/purchase-request.schema';
import {
  CreatePurchaseRequestDto,
} from './dto/purchase-request.dto';
import { SupplyCatalogService } from '../supply-catalog/supply-catalog.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Counter, CounterDocument } from '../roles/schemas/counter.schema';
import { bumpCounterTo, nextSequence } from '../common/utils/counter.util';
import { sodEnforced } from '../common/utils/sod.util';
import { GoodsReceipt, GoodsReceiptDocument } from '../goods-receipt/schemas/goods-receipt.schema';
import {
  SupplyRequest,
  SupplyRequestDocument,
  SupplyRequestStatus,
} from '../supply-requests/schemas/supply-request.schema';
import { SupplyRequestsService } from '../supply-requests/supply-requests.service';
import { NotificationsService } from '../notifications/notifications.service';

/** ສະຖານະທີ່ຍັງຮັບເຄື່ອງຕາມໃບນີ້ໄດ້ */
export const RECEIVABLE_STATUSES = [
  PurchaseRequestStatus.APPROVED,
  PurchaseRequestStatus.PARTIALLY_RECEIVED,
];

const POPULATE = [
  { path: 'requestedBy', select: 'firstName lastName employeeCode' },
  { path: 'approvedBy', select: 'firstName lastName employeeCode' },
];

@Injectable()
export class PurchaseRequestsService {
  constructor(
    @InjectModel(PurchaseRequest.name)
    private model: Model<PurchaseRequestDocument>,
    @InjectModel(Counter.name) private counterModel: Model<CounterDocument>,
    @InjectModel(GoodsReceipt.name) private receiptModel: Model<GoodsReceiptDocument>,
    private catalogService: SupplyCatalogService,
    private auditLogsService: AuditLogsService,
    @InjectModel(SupplyRequest.name)
    private supplyModel: Model<SupplyRequestDocument>,
    private supplyRequests: SupplyRequestsService,
    private notifications: NotificationsService,
  ) {}

  /**
   * ເພີ່ມຂໍ້ມູນຄຳຂໍເບີກທີ່ຜູກ (linkedSupplyRequest) ໃສ່ໃບສະເໜີ — ສຳລັບສະແດງໃນໜ້າຈໍ ແລະໜ້າຮັບເຄື່ອງ:
   * ຜູ້ຂໍ, ສະຖານະ, ຈຳນວນຊື້/ມາແລ້ວ.
   */
  private async attachLinked(docs: PurchaseRequestDocument[]): Promise<any[]> {
    const ids = [
      ...new Set(docs.map((d) => d.supplyRequestId).filter(Boolean) as string[]),
    ];
    if (ids.length === 0) return docs;
    const srs = await this.supplyModel
      .find({ _id: { $in: ids } })
      .populate('requestedBy', 'firstName lastName employeeCode')
      .lean()
      .exec();
    const byId = new Map(srs.map((s: any) => [String(s._id), s]));
    return docs.map((d) => {
      const obj: any = d.toObject();
      const sr: any = obj.supplyRequestId ? byId.get(obj.supplyRequestId) : undefined;
      if (!sr) return obj;
      const item = sr.items?.[obj.supplyRequestItemIndex ?? -1];
      return {
        ...obj,
        linkedSupplyRequest: {
          _id: sr._id,
          status: sr.status,
          requestedBy: sr.requestedBy,
          itemName: item?.name,
          requestedQty: item?.quantity,
          purchaseQty: item?.purchaseQty,
          arrivedQty: item?.arrivedQty ?? 0,
          readyToCollectAt: sr.readyToCollectAt,
          rejectionReason: sr.rejectionReason,
        },
      };
    });
  }

  /** ຄຳຂໍເບີກທີ່ຜູກ ແລະຍັງລໍອະນຸມັດ (ຖ້າມີ) */
  private async pendingLinkedRequest(doc: PurchaseRequestDocument) {
    if (!doc.supplyRequestId) return null;
    const sr = await this.supplyModel.findById(doc.supplyRequestId).exec();
    return sr && sr.status === SupplyRequestStatus.REQUESTED ? sr : null;
  }

  /** ແຈ້ງຜູ້ຂໍວ່າໃບສະເໜີທີ່ຜູກຖືກປະຕິເສດ/ຍົກເລີກ ແລະຄຳຂໍເບີກຍັງຄ້າງ — ລົ້ມເຫລວບໍ່ກະທົບ */
  private async notifyLinkedStalled(
    doc: PurchaseRequestDocument,
    what: 'ປະຕິເສດ' | 'ຍົກເລີກ',
  ) {
    try {
      const sr = await this.pendingLinkedRequest(doc);
      if (!sr) return;
      await this.notifications.notify(
        String(sr.requestedBy),
        'SUPPLY_REQUEST_PURCHASE_STALLED',
        String(sr._id),
        'SupplyRequest',
        `ໃບສະເໜີຊື້ຖືກ${what}: ${doc.prNo}`,
        `ໃບສະເໜີຊື້ ${doc.prNo} ທີ່ຜູກກັບຄຳຂໍເບີກ ${sr._id} ຖືກ${what} — ສ່ວນທີ່ສະຕັອກບໍ່ພໍຍັງບໍ່ໄດ້ຮັບການຈັດຫາ ຄຳຂໍຈຶ່ງຍັງຄ້າງລໍຖ້າ`,
      );
    } catch {
      // the decision is saved; a failed notification must not undo it
    }
  }

  private async nextPrNo(): Promise<string> {
    const last = await this.model
      .findOne({ prNo: /^PR-\d+$/ }, { prNo: 1 })
      .sort({ prNo: -1 })
      .exec();
    const max = last?.prNo ? parseInt(last.prNo.slice(3), 10) : 0;
    if (Number.isFinite(max)) {
      await bumpCounterTo(this.counterModel, 'purchaseRequest', max);
    }
    const seq = await nextSequence(this.counterModel, 'purchaseRequest');
    return `PR-${String(seq).padStart(4, '0')}`;
  }

  async create(dto: CreatePurchaseRequestDto, userId: string, ip?: string) {
    let itemName: string;
    let unit: string | undefined;
    let catalogItemId: string | undefined;
    let newItem: PurchaseRequest['newItem'];

    if (dto.mode === PurchaseRequestMode.RESTOCK) {
      if (!dto.catalogItemId) {
        throw new BadRequestException('ກະລຸນາເລືອກລາຍການ');
      }
      const item = await this.catalogService.findOne(dto.catalogItemId);
      if (item.isActive === false) {
        throw new BadRequestException(`ລາຍການ "${item.name}" ຖືກປິດໃຊ້ງານ`);
      }
      itemName = item.name;
      unit = item.unit;
      catalogItemId = String(item._id);
    } else {
      if (!dto.item) {
        throw new BadRequestException('ກະລຸນາໃສ່ຂໍ້ມູນລາຍການໃໝ່');
      }
      const name = dto.item.name.trim();
      const similar = await this.catalogService.findByName(name);
      if (similar) {
        throw new ConflictException(
          `ມີລາຍການ "${similar.name}" (${similar._id}) ໃນ Catalog ແລ້ວ — ກະລຸນາສະເໜີແບບ "ເພີ່ມ" ແທນ`,
        );
      }
      itemName = name;
      unit = dto.item.unit.trim();
      newItem = {
        name,
        category: dto.item.category.trim(),
        unit,
        type: dto.item.type,
      };
    }

    const estimatedTotal =
      dto.estimatedUnitPrice !== undefined
        ? dto.estimatedUnitPrice * dto.quantity
        : undefined;

    const doc = await this.model.create({
      prNo: await this.nextPrNo(),
      mode: dto.mode,
      catalogItemId,
      newItem,
      itemName,
      unit,
      quantity: dto.quantity,
      estimatedUnitPrice: dto.estimatedUnitPrice,
      estimatedTotal,
      vendor: dto.vendor?.trim() || undefined,
      reason: dto.reason.trim(),
      neededBy: dto.neededBy ? new Date(dto.neededBy) : undefined,
      status: PurchaseRequestStatus.PENDING,
      requestedBy: new Types.ObjectId(userId),
    });
    await this.auditLogsService.log(
      userId,
      'PR_CREATED',
      'PurchaseRequest',
      String(doc._id),
      undefined,
      { prNo: doc.prNo, item: itemName, quantity: dto.quantity, estimatedTotal },
      ip,
    );
    return this.findOne(String(doc._id));
  }

  /** scopeUserId = ສະເພາະໃບຂອງຜູ້ນັ້ນ; undefined = ເຫັນທັງໝົດ */
  async findAll(status?: PurchaseRequestStatus, scopeUserId?: string, q?: string) {
    const query: Record<string, any> = {};
    if (status && Object.values(PurchaseRequestStatus).includes(status)) {
      query.status = status;
    }
    if (scopeUserId) query.requestedBy = new Types.ObjectId(scopeUserId);
    if (q?.trim()) {
      const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ prNo: rx }, { itemName: rx }, { vendor: rx }];
    }
    const docs = await this.model
      .find(query)
      .sort({ createdAt: -1 })
      .limit(500)
      .populate(POPULATE)
      .exec();
    return this.attachLinked(docs);
  }

  async suggestPrice(catalogItemId: string) {
    const id = catalogItemId?.trim();
    if (!id) return { found: false };

    const [receipt] = await this.receiptModel
      .find(
        { catalogItemId: id, unitPrice: { $gt: 0 } },
        { unitPrice: 1, vendor: 1, receivedDate: 1, receiptNo: 1 },
      )
      .sort({ unitPrice: 1, receivedDate: -1 })
      .limit(1)
      .lean()
      .exec();

    const [request] = await this.model
      .find(
        {
          catalogItemId: id,
          estimatedUnitPrice: { $gt: 0 },
          status: {
            $in: [
              PurchaseRequestStatus.APPROVED,
              PurchaseRequestStatus.PARTIALLY_RECEIVED,
              PurchaseRequestStatus.RECEIVED,
            ],
          },
        },
        { estimatedUnitPrice: 1, vendor: 1, createdAt: 1, prNo: 1 },
      )
      .sort({ estimatedUnitPrice: 1, createdAt: -1 })
      .limit(1)
      .lean()
      .exec();

    const candidates: {
      unitPrice: number;
      vendor?: string;
      date?: Date;
      refNo?: string;
      source: string;
    }[] = [];
    if (receipt) {
      candidates.push({
        unitPrice: receipt.unitPrice as number,
        vendor: receipt.vendor,
        date: receipt.receivedDate,
        refNo: receipt.receiptNo,
        source: 'RECEIPT',
      });
    }
    if (request) {
      candidates.push({
        unitPrice: request.estimatedUnitPrice as number,
        vendor: request.vendor,
        date: request.createdAt,
        refNo: request.prNo,
        source: 'REQUEST',
      });
    }

    if (candidates.length === 0) return { found: false };
    candidates.sort((a, b) => a.unitPrice - b.unitPrice);
    const best = candidates[0];
    return {
      found: true,
      unitPrice: best.unitPrice,
      vendor: best.vendor || null,
      date: best.date || null,
      refNo: best.refNo || null,
      source: best.source,
    };
  }

  async findOne(id: string, scopeUserId?: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('ບໍ່ພົບໃບສະເໜີ');
    const doc = await this.model.findById(id).populate(POPULATE).exec();
    if (!doc) throw new NotFoundException('ບໍ່ພົບໃບສະເໜີ');
    if (scopeUserId) {
      const owner = (doc.requestedBy as any)?._id ?? doc.requestedBy;
      if (String(owner) !== scopeUserId) {
        throw new NotFoundException('ບໍ່ພົບໃບສະເໜີ');
      }
    }
    const [withLink] = await this.attachLinked([doc]);
    return withLink;
  }

  private async load(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('ບໍ່ພົບໃບສະເໜີ');
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException('ບໍ່ພົບໃບສະເໜີ');
    return doc;
  }

  private assertPending(doc: PurchaseRequestDocument) {
    if (doc.status !== PurchaseRequestStatus.PENDING) {
      throw new BadRequestException('ໃບສະເໜີນີ້ບໍ່ໄດ້ຢູ່ໃນສະຖານະລໍອະນຸມັດ');
    }
  }

  private async blockSelf(action: string, id: string, actorId: string, ip?: string) {
    await this.auditLogsService.log(
      actorId,
      `SOD_BLOCKED:${action}`,
      'PurchaseRequest',
      id,
      undefined,
      { blocked: true, action },
      ip,
    );
    throw new ForbiddenException(
      'ແຍກໜ້າທີ່: ທ່ານບໍ່ສາມາດອະນຸມັດ/ປະຕິເສດໃບສະເໜີຂອງຕົນເອງ',
    );
  }

  /**
   * ອະນຸມັດໃບສະເໜີ. ຖ້າຜູກກັບຄຳຂໍເບີກທີ່ລໍອະນຸມັດ ຕ້ອງ confirmLinked = true (ຜູ້ອະນຸມັດຮັບຮູ້ແລ້ວ)
   * ແລະຄຳຂໍເບີກຈະຖືກອະນຸມັດພ້ອມກັນ (ສະຖານະ ORDERED ຈົນກວ່າຂອງຈະມາຄົບ).
   */
  async approve(id: string, approverId: string, ip?: string, confirmLinked = false) {
    const doc = await this.load(id);
    this.assertPending(doc);
    if ((await sodEnforced()) && String(doc.requestedBy) === approverId) {
      await this.blockSelf('PR_APPROVE_SELF', id, approverId, ip);
    }
    const linked = await this.pendingLinkedRequest(doc);
    if (linked) {
      if (!confirmLinked) {
        throw new BadRequestException(
          `ໃບນີ້ຜູກກັບຄຳຂໍເບີກ ${linked._id} — ການອະນຸມັດຈະອະນຸມັດຄຳຂໍເບີກພ້ອມກັນ ກະລຸນາຢືນຢັນກ່ອນ`,
        );
      }
      // ກວດຄຳຂໍເບີກວ່າອະນຸມັດໄດ້ແທ້ ກ່ອນປ່ຽນສະຖານະໃບສະເໜີ (ແຍກໜ້າທີ່, ຜູກ Catalog)
      await this.supplyRequests.assertApprovableWithPurchase(
        String(linked._id),
        approverId,
        ip,
      );
    }
    doc.status = PurchaseRequestStatus.APPROVED;
    doc.approvedBy = new Types.ObjectId(approverId);
    doc.approvedAt = new Date();
    await doc.save();
    if (linked) {
      try {
        await this.supplyRequests.approveWithPurchase(
          String(linked._id),
          approverId,
          ip,
        );
      } catch (err) {
        // ບໍ່ໃຫ້ຄ້າງເຄິ່ງທາງ: ຄືນໃບສະເໜີເປັນລໍອະນຸມັດ
        doc.status = PurchaseRequestStatus.PENDING;
        doc.approvedBy = undefined;
        doc.approvedAt = undefined;
        await doc.save();
        throw err;
      }
    }
    await this.auditLogsService.log(
      approverId,
      'PR_APPROVED',
      'PurchaseRequest',
      id,
      { status: PurchaseRequestStatus.PENDING },
      {
        status: doc.status,
        prNo: doc.prNo,
        ...(linked ? { approvedSupplyRequestId: String(linked._id) } : {}),
      },
      ip,
    );
    return this.findOne(id);
  }

  async reject(id: string, approverId: string, reason: string, ip?: string) {
    const doc = await this.load(id);
    this.assertPending(doc);
    if ((await sodEnforced()) && String(doc.requestedBy) === approverId) {
      await this.blockSelf('PR_REJECT_SELF', id, approverId, ip);
    }
    doc.status = PurchaseRequestStatus.REJECTED;
    doc.approvedBy = new Types.ObjectId(approverId);
    doc.approvedAt = new Date();
    doc.rejectReason = reason.trim();
    await doc.save();
    await this.auditLogsService.log(
      approverId,
      'PR_REJECTED',
      'PurchaseRequest',
      id,
      { status: PurchaseRequestStatus.PENDING },
      { status: doc.status, reason: doc.rejectReason, prNo: doc.prNo },
      ip,
    );
    await this.notifyLinkedStalled(doc, 'ປະຕິເສດ');
    return this.findOne(id);
  }

  /** ຜູ້ສະເໜີຍົກເລີກໃບຂອງຕົນເອງໄດ້ ຕອນຍັງລໍອະນຸມັດ */
  async cancel(id: string, userId: string, ip?: string) {
    const doc = await this.load(id);
    this.assertPending(doc);
    if (String(doc.requestedBy) !== userId) {
      throw new ForbiddenException('ຍົກເລີກໄດ້ສະເພາະໃບຂອງຕົນເອງ');
    }
    doc.status = PurchaseRequestStatus.CANCELLED;
    await doc.save();
    await this.auditLogsService.log(
      userId,
      'PR_CANCELLED',
      'PurchaseRequest',
      id,
      { status: PurchaseRequestStatus.PENDING },
      { status: doc.status, prNo: doc.prNo },
      ip,
    );
    await this.notifyLinkedStalled(doc, 'ຍົກເລີກ');
    return this.findOne(id);
  }

  // ===== ໃຊ້ໂດຍ GoodsReceiptService (ໃນ transaction ດຽວກັນ) =====

  /** ກວດວ່າໃບນີ້ຮັບເຄື່ອງໄດ້ ແລະຄືນ doc (ທັງໝົດໃນ session) */
  async loadForReceiveInTx(
    id: string,
    quantity: number,
    actorId: string,
    session?: ClientSession,
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('ບໍ່ພົບໃບສະເໜີ');
    }
    const doc = await this.model.findById(id).session(session ?? null).exec();
    if (!doc) throw new NotFoundException('ບໍ່ພົບໃບສະເໜີ');
    if (!RECEIVABLE_STATUSES.includes(doc.status)) {
      throw new BadRequestException(
        `ໃບສະເໜີ ${doc.prNo} ຍັງບໍ່ຖືກອະນຸມັດ ຫຼືຮັບຄົບແລ້ວ — ຮັບເຄື່ອງບໍ່ໄດ້`,
      );
    }
    if (
      (await sodEnforced()) &&
      doc.approvedBy &&
      String(doc.approvedBy) === actorId
    ) {
      throw new ForbiddenException(
        'ແຍກໜ້າທີ່: ຜູ້ອະນຸມັດໃບສະເໜີບໍ່ສາມາດເປັນຜູ້ຮັບເຄື່ອງຂອງໃບນັ້ນ',
      );
    }
    const remaining = doc.quantity - doc.receivedQuantity;
    if (quantity > remaining) {
      throw new BadRequestException(
        `ຈຳນວນເກີນໃບສະເໜີ ${doc.prNo}: ເຫຼືອຮັບໄດ້ ${remaining} (ຂໍ ${doc.quantity}, ຮັບແລ້ວ ${doc.receivedQuantity})`,
      );
    }
    return doc;
  }

  async applyReceiptInTx(
    doc: PurchaseRequestDocument,
    quantity: number,
    receiptId: string,
    catalogItemId: string,
    session?: ClientSession,
  ) {
    doc.receivedQuantity += quantity;
    doc.receiptIds.push(receiptId);
    if (!doc.catalogItemId) doc.catalogItemId = catalogItemId;
    doc.status =
      doc.receivedQuantity >= doc.quantity
        ? PurchaseRequestStatus.RECEIVED
        : PurchaseRequestStatus.PARTIALLY_RECEIVED;
    await doc.save({ session });
  }
}
