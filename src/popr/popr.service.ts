import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
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
import { AssetStatus } from '../assets/schemas/asset.schema';
import {
  AuditEvent,
  runInTransaction,
  TxCtx,
} from '../common/utils/transaction.util';

interface UnitInput {
  serialNumber?: string;
  assetId?: string;
}

@Injectable()
export class PoprService implements OnModuleInit {
  private readonly logger = new Logger(PoprService.name);

  constructor(
    @InjectModel(PoprRecord.name)
    private poprModel: Model<PoprRecordDocument>,
    private assetsService: AssetsService,
    private catalogService: SupplyCatalogService,
    private usersService: UsersService,
    @InjectModel(Counter.name) private counterModel: Model<CounterDocument>,
    @InjectConnection() private connection: Connection,
  ) {}

  /**
   * ແກ້ບັນຫາ E11000 ຂອງ PO/S/N ຫວ່າງ ('') — ລ້າງຄ່າ '' ເກົ່າ, drop index ເກົ່າ (sparse) ທີ່ບໍ່ຂ້າມ '' ແລ້ວສ້າງໃໝ່
   * ເປັນ partial index. ເຮັດຄັ້ງດຽວຕອນເລີ່ມລະບົບ (ປອດໄພທີ່ຈະຮັນຊ້ຳ).
   */
  async onModuleInit() {
    try {
      const coll = this.poprModel.collection;
      await coll.updateMany(
        { 'procurement.poNumber': '' },
        { $unset: { 'procurement.poNumber': '' } },
      );
      await coll.updateMany(
        { 'receiving.serialNumber': '' },
        { $unset: { 'receiving.serialNumber': '' } },
      );
      const indexes: any[] = await coll.indexes();
      for (const name of [
        'procurement.poNumber_1',
        'receiving.serialNumber_1',
      ]) {
        const idx = indexes.find((i) => i.name === name);
        if (idx && !idx.partialFilterExpression) {
          await coll.dropIndex(name);
          this.logger.log(
            `Dropped legacy index ${name} (recreated as partial)`,
          );
        }
      }
      await this.poprModel.createIndexes();
    } catch (err: any) {
      this.logger.warn(`POPR index migration skipped: ${err?.message ?? err}`);
    }
  }

  /** ຕັດຊ່ອງຫວ່າງ ແລະ ເອົາ string ຫວ່າງ ('') ອອກ — ເກັບເປັນ "ບໍ່ມີຄ່າ" ແທນ */
  private cleanStrings<T extends Record<string, any>>(obj: T): T {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') {
        const t = v.trim();
        if (t !== '') out[k] = t;
      } else if (v !== undefined && v !== null) {
        out[k] = v;
      }
    }
    return out as T;
  }

  /** ໜ່ວຍທີ່ໃຊ້ຈິງ: units ຖ້າມີ, ຖ້າບໍ່ມີ (ຂໍ້ມູນເກົ່າ) ໃຊ້ serialNumber/assetId ໜ່ວຍດຽວ */
  private effectiveUnits(record: PoprRecordDocument): UnitInput[] {
    const o: any = record.receiving ?? {};
    const units: UnitInput[] = (o.units ?? []).map((u: any) => ({
      serialNumber: u.serialNumber || undefined,
      assetId: u.assetId ? String(u.assetId) : undefined,
    }));
    if (units.length > 0) return units;
    if (o.serialNumber || o.assetId) {
      return [
        {
          serialNumber: o.serialNumber || undefined,
          assetId: o.assetId ? String(o.assetId) : undefined,
        },
      ];
    }
    return [];
  }

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
      payload.procurement = this.cleanStrings({ ...dto.procurement });
    }
    if (dto.receiving) {
      const { receivedDate, receivedByUserId, assetId, units, ...rest } =
        dto.receiving;
      payload.receiving = {
        ...this.cleanStrings(rest),
        units: (units ?? []).map((u) =>
          this.cleanStrings({
            serialNumber: u.serialNumber,
            assetId: u.assetId,
          }),
        ),
        ...(assetId ? { assetId } : {}),
        ...(receivedByUserId
          ? { receivedByUserId: new Types.ObjectId(receivedByUserId) }
          : {}),
        ...(receivedDate ? { receivedDate: new Date(receivedDate) } : {}),
      };
    }
    if (dto.preparation) {
      payload.preparation = this.cleanStrings({ ...dto.preparation });
    }
    if (dto.release) {
      const { deliveryDate, deliveredToUserId, assignedUserId, ...rest } =
        dto.release;
      payload.release = {
        ...this.cleanStrings(rest),
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
   * - CONSUMABLE (ວັດສະດຸສິ້ນເປືອງ): ບໍ່ຕ້ອງ S/N/OS/ລາຍເຊັນ/ຜູ້ຮັບ (ເຂົ້າຄັງ, ບໍ່ໄດ້ມອບໃຫ້ຄົນ); ຕ້ອງມີຈຳນວນທີ່ຮັບ
   * - ELECTRONIC: ຕ້ອງມີຂໍ້ມູນຕໍ່ໜ່ວຍ (S/N ຫຼືຜູກຊັບສິນເດີມ) ຄົບຕາມຈຳນວນທີ່ຈັດຊື້
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
    } else {
      const qty = p.quantity ?? 1;
      const units = this.effectiveUnits(record);
      if (units.length > qty) {
        throw new BadRequestException(
          `ຈຳນວນໜ່ວຍທີ່ຮັບ (${units.length}) ເກີນຈຳນວນທີ່ຈັດຊື້ (${qty})`,
        );
      }
      if (isElectronic) {
        if (units.length < qty)
          missing.push(
            `receiving.units (ຕ້ອງ ${qty} ໜ່ວຍ, ມີ ${units.length})`,
          );
        units.forEach((u, i) => {
          if (!u.serialNumber && !u.assetId)
            missing.push(`receiving.units[${i + 1}].serialNumber`);
        });
        if (!o.snMatch) missing.push('receiving.snMatch');
      }
    }

    if (isElectronic) {
      const c = record.preparation ?? {};
      if (!c.os) missing.push('preparation.os');
      if (!c.secAntivirus && !c.secEdr && !c.secFirewall)
        missing.push('preparation.securitySoftware');
    }

    const r = record.release ?? {};
    // ຂອງສິ້ນເປືອງເຂົ້າຄັງ — ບໍ່ບັງຄັບຜູ້ຮັບ/ລາຍເຊັນ
    if (!isConsumable) {
      if (!r.deliveredTo) missing.push('release.deliveredTo');
      if (!r.assignedUser) missing.push('release.assignedUser');
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

  /** S/N ຕ້ອງບໍ່ຊ້ຳ ທັງໃນ POPR ອື່ນ (ທຸກໜ່ວຍ) ແລະ ໃນທະບຽນຊັບສິນ (ບໍ່ສົນຕົວພິມນ້ອຍ-ໃຫຍ່) */
  private async assertUniqueSerial(serial: string, selfId?: string) {
    const escaped = serial.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(`^${escaped}$`, 'i');
    const q: Record<string, any> = {
      $or: [
        { 'receiving.units.serialNumber': rx },
        { 'receiving.serialNumber': rx },
      ],
    };
    if (selfId) q._id = { $ne: selfId };
    const dup = await this.poprModel.findOne(q).exec();
    if (dup) {
      throw new ConflictException(
        `Serial number "${serial}" is already used by ${dup._id}`,
      );
    }
    const asset = await this.assetsService.findBySerialNumber(serial);
    if (asset) {
      throw new ConflictException(
        `Serial number "${serial}" is already registered on asset ${asset.assetTag}`,
      );
    }
  }

  private async assertAssetLinkable(assetId: string, selfId?: string) {
    const asset = await this.assetsService.findOne(assetId).catch(() => null);
    if (!asset)
      throw new BadRequestException(`receiving: asset "${assetId}" not found`);
    const q: Record<string, any> = {
      $or: [
        { 'receiving.assetId': assetId },
        { 'receiving.units.assetId': assetId },
      ],
    };
    if (selfId) q._id = { $ne: selfId };
    const dup = await this.poprModel.findOne(q).exec();
    if (dup) {
      throw new ConflictException(
        `Asset "${assetId}" is already linked to ${dup._id}`,
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
      const serial = o.serialNumber?.trim();
      if (serial) await this.assertUniqueSerial(serial, selfId);
      if (o.assetId) await this.assertAssetLinkable(o.assetId, selfId);

      // ຕໍ່ໜ່ວຍ: ເລືອກທາງດຽວຕໍ່ໜ່ວຍ — ຜູກຊັບສິນເດີມ (assetId) ຫຼື ສ້າງໃໝ່ດ້ວຍ S/N
      const seenSerial = new Set<string>();
      const seenAsset = new Set<string>();
      for (const [i, u] of (o.units ?? []).entries()) {
        const n = i + 1;
        if (u.assetId) {
          if (seenAsset.has(u.assetId))
            throw new ConflictException(
              `ໜ່ວຍທີ ${n}: ຊັບສິນ ${u.assetId} ຖືກຜູກຊ້ຳໃນລາຍການດຽວກັນ`,
            );
          seenAsset.add(u.assetId);
          await this.assertAssetLinkable(u.assetId, selfId);
          continue; // ໜ່ວຍທີ່ຜູກຊັບສິນເດີມ ບໍ່ໃຊ້ S/N ທີ່ປ້ອນ
        }
        const sn = u.serialNumber?.trim();
        if (sn) {
          const key = sn.toLowerCase();
          if (seenSerial.has(key))
            throw new ConflictException(
              `ໜ່ວຍທີ ${n}: S/N "${sn}" ຊ້ຳໃນລາຍການດຽວກັນ`,
            );
          seenSerial.add(key);
          await this.assertUniqueSerial(sn, selfId);
        }
      }
    }

    const p = dto.procurement;
    const po = p?.poNumber?.trim();
    if (po) await this.assertUniquePo(po, selfId);

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

  /**
   * ຮັບປະກັນວ່າລາຍການນີ້ມີ catalog ໃນທະບຽນແລ້ວ — ສ້າງໃຫ້ທັນທີຕອນບັນທຶກຮ່າງ/ກຳລັງດຳເນີນການ
   * ເພື່ອໃຫ້ອຸປະກອນທີ່ພິມໃໝ່ຂຶ້ນໃນ "ລາຍການອຸປະກອນ" ທັນທີ (ບໍ່ລໍຖ້າປິດ POPR).
   * ຖ້າຂໍ້ມູນຍັງບໍ່ພໍສ້າງ (ຂາດ category/unit) ຈະຂ້າມໄປ ແລ້ວປິດ POPR ຈຶ່ງສ້າງ.
   */
  private async ensureCatalogItem(
    record: PoprRecordDocument,
    ctx: TxCtx,
    actorId: string,
    ip?: string,
  ): Promise<string | undefined> {
    const p = record.procurement;
    if (p.catalogItemId) {
      await this.catalogService.findOne(p.catalogItemId, ctx.session);
      return p.catalogItemId;
    }
    const name = p.itemName?.trim();
    if (!name) return undefined;
    const category = p.category?.trim();
    const unit = p.unit?.trim();
    if (!category || !unit) return undefined;

    const existing = await this.catalogService.findByName(name, ctx.session);
    if (existing) {
      record.set('procurement.catalogItemId', existing._id);
      return existing._id;
    }
    const created = await this.catalogService.createInTx(
      {
        name,
        category,
        unit,
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
    record.set('procurement.catalogItemId', created._id);
    return created._id;
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
   * - ສ້າງ/ຫາ catalog
   * - ELECTRONIC/GENERAL: ຕໍ່ໜ່ວຍ — ຜູກຊັບສິນເດີມແລ້ວມອບໃຫ້ຜູ້ຮັບ (ບໍ່ສ້າງຊ້ຳ) ຫຼື ສ້າງຊັບສິນໃໝ່ພ້ອມ S/N.
   *   ຊັບສິນບໍ່ບວກສະຕ໊ອກ: ສະຕ໊ອກ = ຈຳນວນຊັບສິນ AVAILABLE ແລະ ຊັບສິນເຫຼົ່ານີ້ຖືກມອບທັນທີ (ASSIGNED).
   * - CONSUMABLE: ບວກສະຕ໊ອກຕາມຈຳນວນທີ່ຮັບ (ບໍ່ມີຜູ້ຮັບ)
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
    const appliedLinkedAssetIds: string[] = [];
    if (!isConsumable) {
      const qty = p.quantity ?? 1;
      const assigneeId = String(record.release.assignedUserId);
      const assignee = await this.usersService.findOneRaw(assigneeId);
      const units = this.effectiveUnits(record);
      const tags: string[] = [];
      const resultUnits: UnitInput[] = [];
      const allIds: string[] = [];
      const note = `ຈາກ POPR ${record._id}`;

      for (let i = 0; i < qty; i++) {
        const u: UnitInput = units[i] ?? {};
        if (u.assetId) {
          // ຜູກຊັບສິນເດີມ — ບໍ່ສ້າງຊ້ຳ
          const asset = await this.assetsService.findOne(
            u.assetId,
            ctx.session,
          );
          if (asset.status === AssetStatus.AVAILABLE) {
            await this.assetsService.assignInCtx(
              asset,
              assigneeId,
              note,
              actorId,
              ip,
              ctx,
            );
            appliedLinkedAssetIds.push(String(asset._id));
          } else if (!(
            asset.status === AssetStatus.ASSIGNED &&
            String(asset.currentAssigneeId) === assigneeId
          )) {
            throw new BadRequestException(
              `ໜ່ວຍທີ ${i + 1}: ຊັບສິນ ${asset.assetTag} ຜູກບໍ່ໄດ້ — ສະຖານະ ${asset.status} (ຕ້ອງວ່າງ ຫຼື ມອບໃຫ້ຜູ້ຮັບນີ້ຢູ່ແລ້ວ)`,
            );
          }
          tags.push(asset.assetTag);
          allIds.push(String(asset._id));
          resultUnits.push({
            serialNumber: asset.serialNumber || undefined,
            assetId: String(asset._id),
          });
        } else {
          const asset = await this.assetsService.createAssignedAssetInTx(
            {
              type: p.itemName!,
              catalogItemId,
              branchId: assignee.branchId,
              assigneeId,
              serialNumber: u.serialNumber,
              note,
              purchaseDate: record.receiving?.receivedDate?.toISOString(),
            },
            ctx,
            actorId,
            ip,
          );
          appliedAssetIds.push(String(asset._id));
          tags.push(asset.assetTag);
          allIds.push(String(asset._id));
          resultUnits.push({
            serialNumber: u.serialNumber,
            assetId: String(asset._id),
          });
        }
      }
      record.set('receiving.units', resultUnits);
      if (allIds.length > 0) record.set('receiving.assetId', allIds[0]);
      if (tags.length > 0) record.set('receiving.assetTag', tags.join(', '));
      record.set('receiving.assetRegistered', true);
    }

    // ສະຕ໊ອກ: ບວກສະເພາະ CONSUMABLE (ຊັບສິນນັບຈາກສະຖານະ AVAILABLE ຂອງຊັບສິນເອງ)
    const deltaQty = isConsumable
      ? (record.receiving.receivedQuantity ?? p.quantity ?? 0)
      : 0;
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
    record.set('appliedLinkedAssetIds', appliedLinkedAssetIds);
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

    const audits: AuditEvent[] = [];
    await runInTransaction(this.connection, async (session) => {
      audits.length = 0;
      const ctx: TxCtx = { session, audits };
      if (status === PoprStatus.COMPLETED) {
        this.assertCompletable(record);
        this.assertSoD(record, userId);
        await this.applyCompletion(record, ctx, userId, ip);
      } else {
        // ຮ່າງ/ກຳລັງດຳເນີນການ → ສ້າງ/ຜູກ catalog ໃຫ້ທັນທີ ໃຫ້ຂຶ້ນໃນລາຍການອຸປະກອນ
        await this.ensureCatalogItem(record, ctx, userId, ip);
      }
      await record.save({ session: session ?? undefined });
    });
    await this.flushAudits(audits);
    return record;
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
        { 'receiving.units.serialNumber': rx },
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
      .populate('receiving.units.assetId', 'assetTag type status serialNumber')
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
      .populate('receiving.units.assetId', 'assetTag type status serialNumber')
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

    // ປ່ຽນຊື່ເປັນລາຍການໃໝ່ (ບໍ່ສົ່ງ catalogItemId ມາ) → ລ້າງການຜູກເກົ່າ ເພື່ອ resolve ໃໝ່
    if (dto.procurement && dto.procurement.catalogItemId === undefined) {
      record.set('procurement.catalogItemId', undefined);
    }

    const audits: AuditEvent[] = [];
    await runInTransaction(this.connection, async (session) => {
      audits.length = 0;
      const ctx: TxCtx = { session, audits };
      if (dto.status === PoprStatus.COMPLETED) {
        this.assertCompletable(record);
        this.assertSoD(record, actorId ?? '');
        await this.applyCompletion(record, ctx, actorId ?? '', ip);
      } else {
        // ຮ່າງ/ກຳລັງດຳເນີນການ → ສ້າງ/ຜູກ catalog ໃຫ້ທັນທີ ໃຫ້ຂຶ້ນໃນລາຍການອຸປະກອນ
        await this.ensureCatalogItem(record, ctx, actorId ?? '', ip);
      }
      await record.save({ session: session ?? undefined });
    });
    await this.flushAudits(audits);
    return record;
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
   * ຍ້ອນກັບຜົນຂ້າງຄຽງຕອນປິດສຳເລັດ (ໃນ transaction ດຽວ) — ໃຊ້ຮ່ວມກັນລະຫວ່າງ reopen ແລະ remove.
   * ກວດກ່ອນ (ບໍ່ແກ້ໄຂຫຍັງຖ້າບໍ່ຜ່ານ):
   *  - ຊັບສິນທີ່ສ້າງ/ມອບ ຕ້ອງຍັງ ASSIGNED ໃຫ້ຜູ້ຮັບເດີມ, ປະຫວັດມອບລາຍການດຽວ, ບໍ່ມີປະຫວັດບຳລຸງຮັກສາ
   *  - ສະຕ໊ອກສິ້ນເປືອງທີ່ບວກໄປ ຕ້ອງຍັງຢູ່ຄົບ (ຖ້າຖືກເບີກໃຊ້ໄປແລ້ວ → ປະຕິເສດ)
   * ຜ່ານແລ້ວຈຶ່ງ: ລຶບຊັບສິນທີ່ລະບົບສ້າງ, ຄືນຊັບສິນເດີມທີ່ຜູກເປັນ "ວ່າງ", ຕັດສະຕ໊ອກ.
   */
  private async reverseCompletionEffects(
    record: PoprRecordDocument,
    ctx: TxCtx,
    actorId: string,
    ip?: string,
  ): Promise<void> {
    const assigneeId = record.release?.assignedUserId
      ? String(record.release.assignedUserId)
      : undefined;
    const created = record.appliedAssetIds ?? [];
    const linked = record.appliedLinkedAssetIds ?? [];
    const catalogItemId = record.procurement.catalogItemId;
    const stockDelta = record.appliedStockDelta ?? 0;

    // 1) ກວດທັງໝົດກ່ອນ
    await this.assetsService.assertReversibleByPopr(created, assigneeId, ctx);
    await this.assetsService.assertReversibleByPopr(linked, assigneeId, ctx, {
      linked: true,
    });
    if (catalogItemId && stockDelta > 0) {
      const item = await this.catalogService.findOne(
        catalogItemId,
        ctx.session,
      );
      if (item.stockQty < stockDelta) {
        throw new BadRequestException(
          `ຍ້ອນກັບບໍ່ໄດ້: ສະຕ໊ອກ "${item.name}" ເຫຼືອ ${item.stockQty} ຕ່ຳກວ່າຈຳນວນທີ່ POPR ນີ້ເພີ່ມ (${stockDelta}) — ມີການເບີກໃຊ້ໄປແລ້ວ`,
        );
      }
    }

    // 2) ຍ້ອນກັບ
    await this.assetsService.deleteAssetsInTx(
      created,
      assigneeId,
      ctx,
      actorId,
      ip,
    );
    await this.assetsService.unassignLinkedInTx(
      linked,
      assigneeId,
      `ຍ້ອນກັບຈາກ POPR ${record._id}`,
      ctx,
      actorId,
      ip,
    );

    if (catalogItemId && stockDelta > 0) {
      const before = await this.catalogService.findOne(
        catalogItemId,
        ctx.session,
      );
      const r = await this.catalogService.adjustStockTracked(
        catalogItemId,
        -stockDelta,
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
          delta: -stockDelta,
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
      const generated = new Set((record.appliedAssetIds ?? []).map(String));
      const linked = new Set((record.appliedLinkedAssetIds ?? []).map(String));
      const linkedAssetId = record.receiving.assetId
        ? String(record.receiving.assetId)
        : undefined;
      // ລຶບ assetId ທີ່ລະບົບຕື່ມ/ສ້າງເທົ່ານັ້ນ — ຖ້າຜູ້ໃຊ້ກຳນົດ asset ດ້ວຍຕົນເອງ (ບໍ່ຢູ່ໃນລາຍການທີ່ລະບົບໃຊ້) ຄວນຮັກສາໄວ້
      if (
        linkedAssetId &&
        (generated.has(linkedAssetId) || linked.has(linkedAssetId))
      ) {
        record.set('receiving.assetId', undefined);
      }
      // ໜ່ວຍ: ເກັບ S/N ໄວ້ແກ້ໄຂຕໍ່; ປົດ assetId ຂອງຊັບສິນທີ່ຖືກລຶບແລ້ວ (ຊັບສິນເດີມທີ່ຜູກຍັງຜູກຢູ່)
      const units = (record.receiving.units ?? []).map((u: any) => ({
        serialNumber: u.serialNumber || undefined,
        assetId:
          u.assetId && !generated.has(String(u.assetId))
            ? String(u.assetId)
            : undefined,
      }));
      record.set('receiving.units', units);
      if (generated.size > 0 || linked.size > 0) {
        record.set('receiving.assetTag', undefined);
      }
      record.set('receiving.assetRegistered', false);
      record.set('appliedAssetIds', []);
      record.set('appliedLinkedAssetIds', []);
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
