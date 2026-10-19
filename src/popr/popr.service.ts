import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import {
  PoprItemType,
  PoprRecord,
  PoprRecordDocument,
  PoprStatus,
} from './schemas/popr-record.schema';
import { CreatePoprRecordDto } from './dto/create-popr-record.dto';
import { UpdatePoprRecordDto } from './dto/update-popr-record.dto';
import { AssetsService } from '../assets/assets.service';
import { SupplyCatalogService } from '../supply-catalog/supply-catalog.service';
import { UsersService } from '../users/users.service';
import { sodEnforced } from '../common/utils/sod.util';
import { bumpCounterTo, nextSequence } from '../common/utils/counter.util';
import { Counter, CounterDocument } from '../roles/schemas/counter.schema';
import {
  AuditEvent,
  runInTransaction,
  TxCtx,
} from '../common/utils/transaction.util';

@Injectable()
export class PoprService {
  constructor(
    @InjectModel(PoprRecord.name)
    private poprModel: Model<PoprRecordDocument>,
    private assetsService: AssetsService,
    private catalogService: SupplyCatalogService,
    private usersService: UsersService,
    @InjectModel(Counter.name) private counterModel: Model<CounterDocument>,
    @InjectConnection() private connection: Connection,
  ) {}

  /** ສ້າງ ID ດ້ວຍ counter (atomic $inc) ເພື່ອຫຼີກການຊ້ຳ ID ເມື່ອສ້າງພ້ອມກັນ */
  private async generateId(session?: ClientSession): Promise<string> {
    const last = await this.poprModel
      .findOne({ _id: /^POPR-\d{4}$/ }, { _id: 1 })
      .sort({ _id: -1 })
      .session(session ?? null)
      .exec();
    const maxSeq = last
      ? parseInt(String(last._id).slice('POPR-'.length), 10)
      : 0;
    if (Number.isFinite(maxSeq)) {
      await bumpCounterTo(this.counterModel, 'popr', maxSeq, session);
    }
    const seq = await nextSequence(this.counterModel, 'popr', session);
    return `POPR-${String(seq).padStart(4, '0')}`;
  }

  /** ແປງ DTO (ມີ string ວັນທີ) → payload ທີ່ບັນທຶກໄດ້ (Date) */
  private buildPayload(dto: CreatePoprRecordDto | UpdatePoprRecordDto) {
    const payload: Record<string, any> = {};
    if (dto.status !== undefined) payload.status = dto.status;
    if (dto.itemType !== undefined) payload.itemType = dto.itemType;
    if (dto.stage !== undefined) payload.stage = dto.stage;

    if (dto.procurement) {
      payload.procurement = { ...dto.procurement };
    }
    if (dto.receiving) {
      const { receivedDate, receivedByUserId, assetId, ...rest } =
        dto.receiving;
      payload.receiving = {
        ...rest,
        ...(assetId ? { assetId } : {}),
        ...(receivedByUserId
          ? { receivedByUserId: new Types.ObjectId(receivedByUserId) }
          : {}),
        ...(receivedDate ? { receivedDate: new Date(receivedDate) } : {}),
      };
    }
    if (dto.preparation) {
      payload.preparation = { ...dto.preparation };
    }
    if (dto.release) {
      const { deliveryDate, deliveredToUserId, assignedUserId, ...rest } =
        dto.release;
      payload.release = {
        ...rest,
        ...(deliveredToUserId
          ? { deliveredToUserId: new Types.ObjectId(deliveredToUserId) }
          : {}),
        ...(assignedUserId
          ? { assignedUserId: new Types.ObjectId(assignedUserId) }
          : {}),
        ...(deliveryDate ? { deliveryDate: new Date(deliveryDate) } : {}),
      };
    }
    return payload;
  }

  /**
   * ບັງຄັບຂໍ້ມູນຈຳເປັນກ່ອນປິດສຳເລັດ — ແຕກຕ່າງຕາມປະເພດ:
   * - ELECTRONIC: ຕ້ອງມີ S/N, snMatch, OS ແລະ ຊອບແວຄວາມປອດໄພ
   * - GENERAL: ບໍ່ຕ້ອງ S/N/OS/ຄວາມປອດໄພ
   * - CONSUMABLE (ວັດສະດຸສິ້ນເປືອງ): ບໍ່ຕ້ອງ S/N/OS/ລາຍເຊັນ; ຕ້ອງມີຈຳນວນທີ່ຮັບ
   */
  private assertCompletable(record: PoprRecordDocument) {
    const missing: string[] = [];
    const type = record.itemType;
    const isConsumable = type === PoprItemType.CONSUMABLE;
    const isElectronic = type === PoprItemType.ELECTRONIC;

    const p = record.procurement ?? {};
    if (!p.itemName) missing.push('procurement.itemName');
    if (!p.spec) missing.push('procurement.spec');
    if (p.budget === undefined || p.budget === null)
      missing.push('procurement.budget');
    if (!p.vendor) missing.push('procurement.vendor');
    if (!p.poNumber) missing.push('procurement.poNumber');
    // ຖ້າບໍ່ມີ catalogItemId ລະບົບຈະສ້າງລາຍການ catalog ໃໝ່ → ຕ້ອງມີ category/unit
    if (!p.catalogItemId) {
      if (!p.category) missing.push('procurement.category');
      if (!p.unit) missing.push('procurement.unit');
    }

    const o = record.receiving ?? {};
    if (!o.receivedDate) missing.push('receiving.receivedDate');
    if (isConsumable) {
      if (o.receivedQuantity === undefined || o.receivedQuantity === null)
        missing.push('receiving.receivedQuantity');
    } else if (isElectronic) {
      if (!o.serialNumber) missing.push('receiving.serialNumber');
      if (!o.snMatch) missing.push('receiving.snMatch');
    }

    if (isElectronic) {
      const c = record.preparation ?? {};
      if (!c.os) missing.push('preparation.os');
      if (!c.secAntivirus && !c.secEdr && !c.secFirewall)
        missing.push('preparation.securitySoftware');
    }

    const r = record.release ?? {};
    if (!r.deliveredTo) missing.push('release.deliveredTo');
    if (!r.assignedUser) missing.push('release.assignedUser');
    if (!isConsumable) {
      if (!r.signedHandover) missing.push('release.signedHandover');
      if (!r.assignedUserId) missing.push('release.assignedUserId');
    }

    if (missing.length > 0) {
      throw new BadRequestException(
        `POPR ຍັງບໍ່ສົມບູນ ຈຶ່ງປິດສຳເລັດບໍ່ໄດ້. ຂາດ: ${missing.join(', ')}`,
      );
    }
  }

  /** ແຍກໜ້າທີ່: ຜູ້ສ້າງ POPR ບໍ່ສາມາດປິດດ້ວຍຕົນເອງ (ເປີດໃຊ້ຕາມ SOD_ENFORCE / production) */
  private assertSoD(record: PoprRecordDocument, actorId: string) {
    if (sodEnforced() && String(record.createdBy) === String(actorId)) {
      throw new ForbiddenException(
        'Segregation of duties: ຜູ້ສ້າງ POPR ບໍ່ສາມາດປິດສຳເລັດດ້ວຍຕົນເອງໄດ້',
      );
    }
  }

  private async assertActiveUser(userId: string, field: string) {
    let user: { isActive?: boolean };
    try {
      user = await this.usersService.findOneRaw(userId);
    } catch {
      throw new BadRequestException(`${field}: user "${userId}" not found`);
    }
    if (user.isActive === false) {
      throw new BadRequestException(`${field}: user "${userId}" is inactive`);
    }
  }

  private async assertUniquePo(poNumber: string, selfId?: string) {
    const q: Record<string, any> = { 'procurement.poNumber': poNumber };
    if (selfId) q._id = { $ne: selfId };
    const dup = await this.poprModel.findOne(q).exec();
    if (dup) {
      throw new ConflictException(
        `PO number "${poNumber}" is already used by ${dup._id}`,
      );
    }
  }

  private async assertUniqueSerial(serial: string, selfId?: string) {
    const q: Record<string, any> = { 'receiving.serialNumber': serial };
    if (selfId) q._id = { $ne: selfId };
    const dup = await this.poprModel.findOne(q).exec();
    if (dup) {
      throw new ConflictException(
        `Serial number "${serial}" is already used by ${dup._id}`,
      );
    }
  }

  /** ກວດການຜູກອ້າງອີງ: asset/ຜູ້ໃຊ້ຕ້ອງມີຈິງ, asset ບໍ່ຖືກ POPR ອື່ນຜູກ, PO/S/N ບໍ່ຊ້ຳ */
  private async validateLinkage(
    dto: CreatePoprRecordDto | UpdatePoprRecordDto,
    selfId?: string,
  ) {
    const o = dto.receiving;
    if (o) {
      if (o.receivedByUserId)
        await this.assertActiveUser(
          o.receivedByUserId,
          'receiving.receivedByUserId',
        );
      if (o.serialNumber) await this.assertUniqueSerial(o.serialNumber, selfId);
      if (o.assetId) {
        const asset = await this.assetsService
          .findOne(o.assetId)
          .catch(() => null);
        if (!asset)
          throw new BadRequestException(
            `receiving.assetId "${o.assetId}" not found`,
          );
        const q: Record<string, any> = { 'receiving.assetId': o.assetId };
        if (selfId) q._id = { $ne: selfId };
        const dup = await this.poprModel.findOne(q).exec();
        if (dup) {
          throw new ConflictException(
            `Asset "${o.assetId}" is already linked to ${dup._id}`,
          );
        }
      }
    }

    const p = dto.procurement;
    if (p?.poNumber) await this.assertUniquePo(p.poNumber, selfId);

    const r = dto.release;
    if (r) {
      if (r.deliveredToUserId)
        await this.assertActiveUser(
          r.deliveredToUserId,
          'release.deliveredToUserId',
        );
      if (r.assignedUserId)
        await this.assertActiveUser(r.assignedUserId, 'release.assignedUserId');
    }
  }

  /** ຫາ/ສ້າງລາຍການ catalog ທີ່ POPR ນີ້ອ້າງອີງ (ສ້າງໃໝ່ຖ້າບໍ່ມີ) */
  private async resolveCatalogItem(
    record: PoprRecordDocument,
    ctx: TxCtx,
    actorId: string,
    ip?: string,
  ): Promise<string> {
    const p = record.procurement;
    if (p.catalogItemId) {
      await this.catalogService.findOne(p.catalogItemId, ctx.session);
      return p.catalogItemId;
    }
    const name = p.itemName!.trim();
    const existing = await this.catalogService.findByName(name, ctx.session);
    if (existing) return existing._id;
    const created = await this.catalogService.createInTx(
      {
        name,
        category: p.category!,
        unit: p.unit!,
        lowStockThreshold: p.lowStockThreshold,
      },
      ctx,
    );
    ctx.audits.push({
      actorId,
      action: 'CATALOG_CREATED',
      entityType: 'SupplyCatalogItem',
      entityId: created._id,
      before: undefined,
      after: created.toObject(),
      ip,
    });
    return created._id;
  }

  /**
   * ຜົນຂ້າງຄຽງຕອນປິດສຳເລັດ (ໃນ transaction ດຽວ):
   * - ສ້າງ/ຫາ catalog, ສ້າງ asset ຕໍ່ໜ່ວຍໃຫ້ຂອງມີແທັກ, ຫຼື ບວກສະຕ໊ອກໃຫ້ວັດສະດຸສິ້ນເປືອງ
   */
  private async applyCompletion(
    record: PoprRecordDocument,
    ctx: TxCtx,
    actorId: string,
    ip?: string,
  ) {
    const p = record.procurement;
    const isConsumable = record.itemType === PoprItemType.CONSUMABLE;

    const catalogItemId = await this.resolveCatalogItem(
      record,
      ctx,
      actorId,
      ip,
    );
    record.set('procurement.catalogItemId', catalogItemId);

    const appliedAssetIds: string[] = [];
    if (!isConsumable) {
      const qty = p.quantity ?? 1;
      const assigneeId = String(record.release.assignedUserId);
      const assignee = await this.usersService.findOneRaw(assigneeId);
      for (let i = 0; i < qty; i++) {
        const asset = await this.assetsService.createAssignedAssetInTx(
          {
            type: p.itemName!,
            catalogItemId,
            branchId: assignee.branchId,
            assigneeId,
            note: `ຈາກ POPR ${record._id}`,
            purchaseDate: record.receiving?.receivedDate?.toISOString(),
          },
          ctx,
          actorId,
          ip,
        );
        appliedAssetIds.push(String(asset._id));
      }
      if (!record.receiving.assetId && appliedAssetIds.length > 0) {
        record.set('receiving.assetId', appliedAssetIds[0]);
      }
      record.set('receiving.assetRegistered', true);
    }

    const deltaQty = isConsumable
      ? (record.receiving.receivedQuantity ?? p.quantity ?? 0)
      : (p.quantity ?? 1);
    if (deltaQty > 0) {
      const before = await this.catalogService.findOne(
        catalogItemId,
        ctx.session,
      );
      const after = await this.catalogService.adjustStock(
        catalogItemId,
        deltaQty,
        ctx.session,
      );
      ctx.audits.push({
        actorId,
        action: 'CATALOG_STOCK_ADDED',
        entityType: 'SupplyCatalogItem',
        entityId: catalogItemId,
        before: { stockQty: before.stockQty },
        after: { stockQty: after.stockQty, delta: deltaQty },
        ip,
      });
    }

    record.set('appliedAssetIds', appliedAssetIds);
    record.set('appliedStockDelta', deltaQty);
    record.status = PoprStatus.COMPLETED;
    record.stage = 4;
    if (!record.completedAt) record.completedAt = new Date();
  }

  private async flushAudits(audits: AuditEvent[]) {
    await this.assetsService.flushAudits(audits);
  }

  async create(dto: CreatePoprRecordDto, userId: string, ip?: string) {
    await this.validateLinkage(dto);
    const payload = this.buildPayload(dto);
    const status = dto.status ?? PoprStatus.DRAFT;
    const _id = await this.generateId();
    const record = new this.poprModel({
      _id,
      createdBy: new Types.ObjectId(userId),
      ...payload,
      status,
      stage: dto.stage ?? 1,
    });

    if (status === PoprStatus.COMPLETED) {
      const audits: AuditEvent[] = [];
      await runInTransaction(this.connection, async (session) => {
        audits.length = 0;
        this.assertCompletable(record);
        this.assertSoD(record, userId);
        await this.applyCompletion(record, { session, audits }, userId, ip);
        await record.save({ session: session ?? undefined });
      });
      await this.flushAudits(audits);
      return record;
    }

    return record.save();
  }

  findAll(filters: { status?: PoprStatus; q?: string } = {}) {
    const query: Record<string, any> = {};
    if (filters.status) query.status = filters.status;
    if (filters.q) {
      const rx = new RegExp(
        filters.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i',
      );
      query.$or = [
        { _id: rx },
        { 'procurement.itemName': rx },
        { 'procurement.vendor': rx },
        { 'procurement.poNumber': rx },
        { 'receiving.serialNumber': rx },
        { 'receiving.assetTag': rx },
        { 'release.assignedUser': rx },
      ];
    }
    return this.poprModel
      .find(query)
      .sort({ _id: -1 })
      .populate('createdBy', 'firstName lastName email employeeCode')
      .populate('receiving.receivedByUserId', 'firstName lastName employeeCode')
      .populate('release.deliveredToUserId', 'firstName lastName employeeCode')
      .populate('release.assignedUserId', 'firstName lastName employeeCode')
      .populate('receiving.assetId', 'assetTag type status')
      .exec();
  }

  async findOne(id: string) {
    const record = await this.poprModel
      .findById(id)
      .populate('createdBy', 'firstName lastName email employeeCode')
      .populate('receiving.receivedByUserId', 'firstName lastName employeeCode')
      .populate('release.deliveredToUserId', 'firstName lastName employeeCode')
      .populate('release.assignedUserId', 'firstName lastName employeeCode')
      .populate('receiving.assetId', 'assetTag type status')
      .exec();
    if (!record) throw new NotFoundException('POPR record not found');
    return record;
  }

  async update(
    id: string,
    dto: UpdatePoprRecordDto,
    actorId?: string,
    ip?: string,
  ) {
    const record = await this.poprModel.findById(id).exec();
    if (!record) throw new NotFoundException('POPR record not found');

    if (record.status === PoprStatus.COMPLETED) {
      throw new BadRequestException(
        'POPR ທີ່ປິດສຳເລັດແລ້ວ ບໍ່ສາມາດແກ້ໄຂໄດ້ — ຕ້ອງເປີດໃໝ່ໂດຍຜູ້ອະນຸມັດກ່ອນ',
      );
    }

    await this.validateLinkage(dto, id);
    const payload = this.buildPayload(dto);
    Object.assign(record, payload);
    this.clearUnlinkedRefs(record, dto);

    if (dto.status === PoprStatus.COMPLETED) {
      const audits: AuditEvent[] = [];
      await runInTransaction(this.connection, async (session) => {
        audits.length = 0;
        this.assertCompletable(record);
        this.assertSoD(record, actorId ?? '');
        await this.applyCompletion(
          record,
          { session, audits },
          actorId ?? '',
          ip,
        );
        await record.save({ session: session ?? undefined });
      });
      await this.flushAudits(audits);
      return record;
    }

    return record.save();
  }

  private clearUnlinkedRefs(
    record: PoprRecordDocument,
    dto: CreatePoprRecordDto | UpdatePoprRecordDto,
  ) {
    const rec = dto.receiving;
    if (rec) {
      if ('assetId' in rec && !rec.assetId)
        record.set('receiving.assetId', undefined);
      if ('receivedByUserId' in rec && !rec.receivedByUserId)
        record.set('receiving.receivedByUserId', undefined);
    }
    const rel = dto.release;
    if (rel) {
      if ('deliveredToUserId' in rel && !rel.deliveredToUserId)
        record.set('release.deliveredToUserId', undefined);
      if ('assignedUserId' in rel && !rel.assignedUserId)
        record.set('release.assignedUserId', undefined);
    }
  }

  async complete(id: string, actorId: string, ip?: string) {
    const audits: AuditEvent[] = [];
    const saved = await runInTransaction(this.connection, async (session) => {
      audits.length = 0;
      const record = await this.poprModel
        .findById(id)
        .session(session ?? null)
        .exec();
      if (!record) throw new NotFoundException('POPR record not found');
      if (record.status === PoprStatus.COMPLETED) {
        throw new BadRequestException('POPR ນີ້ປິດສຳເລັດແລ້ວ');
      }
      this.assertCompletable(record);
      this.assertSoD(record, actorId);
      await this.applyCompletion(record, { session, audits }, actorId, ip);
      await record.save({ session: session ?? undefined });
      return record;
    });
    await this.flushAudits(audits);
    return saved;
  }

  /**
   * ຍ້ອນກັບຜົນຂ້າງຄຽງຕອນປິດສຳເລັດ (ໃນ transaction ດຽວ):
   * ລຶບ asset ທີ່ລະບົບສ້າງ ແລະ ຕັດສະຕ໊ອກ catalog ທີ່ບວກເຂົ້າ.
   * ໃຊ້ຮ່ວມກັນລະຫວ່າງ reopen ແລະ remove ເພື່ອບໍ່ໃຫ້ເກີດ asset ກຳເຜົາ/stock ຄ້າງ.
   */
  private async reverseCompletionEffects(
    record: PoprRecordDocument,
    ctx: TxCtx,
    actorId: string,
    ip?: string,
  ): Promise<void> {
    if (record.appliedAssetIds?.length) {
      await this.assetsService.deleteAssetsInTx(
        record.appliedAssetIds,
        ctx,
        actorId,
        ip,
      );
    }

    const catalogItemId = record.procurement.catalogItemId;
    if (catalogItemId && record.appliedStockDelta > 0) {
      const before = await this.catalogService.findOne(
        catalogItemId,
        ctx.session,
      );
      const r = await this.catalogService.adjustStockTracked(
        catalogItemId,
        -record.appliedStockDelta,
        ctx.session,
      );
      ctx.audits.push({
        actorId,
        action: 'CATALOG_STOCK_REMOVED',
        entityType: 'SupplyCatalogItem',
        entityId: catalogItemId,
        before: { stockQty: before.stockQty },
        after: {
          stockQty: r.stockAfter,
          delta: -record.appliedStockDelta,
          mismatch: r.mismatch,
        },
        ip,
      });
    }
  }

  /**
   * ເປີດ POPR ທີ່ປິດສຳເລັດແລ້ວຄືນ (ໂດຍຜູ້ມີສິດອະນຸມັດ) — ຍ້ອນກັບຜົນຂ້າງຄຽງທັງໝົດ
   * ທີ່ເກີດຕອນປິດ (ລຶບ asset ທີ່ສ້າງ, ຕັດສະຕ໊ອກທີ່ບວກ) ແລ້ວຕັ້ງກັບເປັນ IN_PROGRESS
   * ເພື່ອໃຫ້ແກ້ໄຂ ແລະ ປິດໃໝ່ໄດ້ຢ່າງຖືກຕ້ອງ (ບໍ່ເກີດ asset/stock ຊ້ຳ).
   */
  async reopen(id: string, reason: string, actorId: string, ip?: string) {
    const audits: AuditEvent[] = [];
    const saved = await runInTransaction(this.connection, async (session) => {
      audits.length = 0;
      const ctx: TxCtx = { session, audits };
      const record = await this.poprModel
        .findById(id)
        .session(session ?? null)
        .exec();
      if (!record) throw new NotFoundException('POPR record not found');
      if (record.status !== PoprStatus.COMPLETED) {
        throw new BadRequestException(
          'ເປີດໃໝ່ໄດ້ສະເພາະ POPR ທີ່ປິດສຳເລັດແລ້ວເທົ່ານັ້ນ',
        );
      }

      // ຍ້ອນກັບຜົນຂ້າງຄຽງທັງໝົດທີ່ເກີດຕອນປິດ (ລຶບ asset ທີ່ສ້າງ + ຕັດສະຕ໊ອກ)
      await this.reverseCompletionEffects(record, ctx, actorId, ip);

      const before = record.toObject();
      const linkedAssetId = record.receiving.assetId
        ? String(record.receiving.assetId)
        : undefined;
      const generatedIds: string[] = record.appliedAssetIds ?? [];
      // ລຶບ assetId ທີ່ລະບົບສ້າງເທົ່ານັ້ນ — ຖ້າຜູ້ໃຊ້ກຳນົດ asset ດ້ວຍຕົນເອງ (ບໍ່ຢູ່ໃນ appliedAssetIds) ຄວນຮັກສາໄວ້
      if (linkedAssetId && generatedIds.includes(linkedAssetId)) {
        record.set('receiving.assetId', undefined);
      }
      record.set('receiving.assetRegistered', false);
      record.set('appliedAssetIds', []);
      record.set('appliedStockDelta', 0);
      record.set('completedAt', undefined);
      record.status = PoprStatus.IN_PROGRESS;
      // stage 4 = ປິດສຳເລັດແລ້ວ — ກັບກັບເປັນ 3 ເພື່ອບໍ່ໃຫ້ IN_PROGRESS ຄ້າງຢູ່ຂັ້ນ 4
      record.stage = 3;
      record.reopenedAt = new Date();
      record.reopenedBy = new Types.ObjectId(actorId);
      record.reopenReason = reason;
      const savedRecord = await record.save({ session: session ?? undefined });

      ctx.audits.push({
        actorId,
        action: 'POPR_REOPENED',
        entityType: 'PoprRecord',
        entityId: id,
        before,
        after: savedRecord.toObject(),
        ip,
      });
      return savedRecord;
    });
    await this.flushAudits(audits);
    return saved;
  }

  async remove(id: string, actorId: string, ip?: string) {
    const audits: AuditEvent[] = [];
    const result = await runInTransaction(this.connection, async (session) => {
      audits.length = 0;
      const ctx: TxCtx = { session, audits };
      const record = await this.poprModel
        .findById(id)
        .session(session ?? null)
        .exec();
      if (!record) throw new NotFoundException('POPR record not found');

      // POPR ທີ່ປິດສຳເລັດແລ້ວ: ຍ້ອນກັບ asset/stock ກ່ອນລຶບ ເພື່ອບໍ່ປ່ອນຂໍ້ມູນກຳເຜົາ
      if (record.status === PoprStatus.COMPLETED) {
        await this.reverseCompletionEffects(record, ctx, actorId, ip);
      }

      await this.poprModel.deleteOne({ _id: id }, { session }).exec();
      return { deleted: true };
    });
    await this.flushAudits(audits);
    return result;
  }
}
