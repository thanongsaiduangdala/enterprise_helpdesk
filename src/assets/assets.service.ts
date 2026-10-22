import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model } from 'mongoose';
import { parse } from 'csv-parse/sync';
import { Asset, AssetDocument, AssetStatus } from './schemas/asset.schema';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { AssignAssetDto } from './dto/assign-asset.dto';
import { ReturnAssetDto } from './dto/return-asset.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { MaintenanceHistoryService } from '../maintenance-history/maintenance-history.service';
import { MaintenanceStatus } from '../maintenance-history/schemas/maintenance-history.schema';
import { SupplyCatalogService } from '../supply-catalog/supply-catalog.service';
import {
  SupplyRequest,
  SupplyRequestDocument,
  SupplyRequestStatus,
} from '../supply-requests/schemas/supply-request.schema';
import { hasPermission, PermissionUser } from '../common/utils/permission.util';
import {
  AuditEvent,
  runInTransaction,
  TxCtx,
} from '../common/utils/transaction.util';
import { sodEnforced } from '../common/utils/sod.util';
import { matchAssetToItem } from '../common/utils/supply-match.util';
import { UsersService } from '../users/users.service';
import { bumpCounterTo, nextSequence } from '../common/utils/counter.util';
import { Counter, CounterDocument } from '../roles/schemas/counter.schema';

@Injectable()
export class AssetsService {
  constructor(
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
    private auditLogsService: AuditLogsService,
    private maintenanceHistoryService: MaintenanceHistoryService,
    private catalogService: SupplyCatalogService,
    @InjectModel(SupplyRequest.name)
    private supplyRequestModel: Model<SupplyRequestDocument>,
    private usersService: UsersService,
    @InjectModel(Counter.name) private counterModel: Model<CounterDocument>,
    @InjectConnection() private connection: Connection,
  ) {}

  private async generateId(session?: ClientSession): Promise<string> {
    // seed ຈາກເລກສູງສຸດທີ່ມີຢູ່ ແລ້ວອອກເລກແບບ monotonic (ບໍ່ໃຊ້ເລກທີ່ຖືກປົດຄືນ)
    const last = await this.assetModel
      .findOne({ _id: /^AS\d{3}$/ }, { _id: 1 })
      .sort({ _id: -1 })
      .session(session ?? null)
      .exec();
    const maxSeq = last ? parseInt(last._id.slice(2), 10) : 0;
    await bumpCounterTo(this.counterModel, 'asset', maxSeq, session);
    const seq = await nextSequence(this.counterModel, 'asset', session);
    return `AS${String(seq).padStart(3, '0')}`;
  }

  async create(dto: CreateAssetDto, actorId?: string, ip?: string) {
    const saved = await this.createInternal(dto);
    // ສະຕ໊ອກ = ຈຳນວນຊັບສິນ AVAILABLE → ຊັບສິນໃໝ່ທີ່ວ່າງ ຕ້ອງບວກສະຕ໊ອກ +1
    if (saved.catalogItemId && saved.status === AssetStatus.AVAILABLE) {
      await this.catalogService.adjustStockTracked(saved.catalogItemId, 1);
    }
    if (actorId) {
      await this.auditLogsService.log(
        actorId,
        'ASSET_CREATED',
        'Asset',
        String(saved._id),
        undefined,
        saved.toObject(),
        ip,
      );
    }
    return saved;
  }

  private async createInternal(dto: CreateAssetDto, session?: ClientSession) {
    const { assetTag, catalogItemId, ...restDto } = dto;
    const rest: Record<string, any> = { ...restDto };
    const sn =
      typeof rest.serialNumber === 'string' ? rest.serialNumber.trim() : '';
    if (sn) rest.serialNumber = sn;
    else delete rest.serialNumber;
    if (rest.serialNumber)
      await this.assertSerialFree(rest.serialNumber, session);

    // ຜູກກັບລາຍການ catalog (ຕ້ອງມີຈິງ)
    if (catalogItemId) {
      await this.catalogService.findOne(catalogItemId, session);
    }

    // ຖ້າຜູ້ໃຊ້ກຣອກ Asset Tag ເອງ → ໃຊ້ຕາມນັ້ນ (ຊ້ຳ = ແຈ້ງ error ປົກກະຕິ)
    if (assetTag) {
      const existing = await this.assetModel
        .findOne({ assetTag })
        .session(session ?? null);
      if (existing) {
        throw new ConflictException(
          `Asset tag "${assetTag}" is already in use`,
        );
      }
      const _id = await this.generateId(session);
      return new this.assetModel({
        _id,
        assetTag,
        catalogItemId,
        ...rest,
      }).save({ session: session ?? undefined });
    }

    // ບໍ່ມີ tag → ຕ້ອງເລືອກ catalog ເພື່ອສ້າງອັດຕະໂນມັດ (SC002-001)
    if (!catalogItemId) {
      throw new BadRequestException(
        'Provide an assetTag or select a catalog item so the system can auto-generate one (e.g. SC002-001)',
      );
    }

    // ສ້າງອັດຕະໂນມັດ + retry ເມື່ອຊົນກັນ (create ພ້ອມກັນຈະໄດ້ seq ດຽວກັນ)
    const maxAttempts = 5;
    for (let attempt = 1; ; attempt++) {
      const tag = await this.generateCatalogAssetTag(catalogItemId, session);
      const _id = await this.generateId(session);
      try {
        return await new this.assetModel({
          _id,
          assetTag: tag,
          catalogItemId,
          ...rest,
        }).save({ session });
      } catch (err: any) {
        const isDuplicate = err?.code === 11000;
        if (!isDuplicate) throw err;
        if (attempt >= maxAttempts) {
          throw new ConflictException(`Asset tag "${tag}" is already in use`);
        }
      }
    }
  }

  /**
   * ສ້າງຊັບສິນພາຍໃນ transaction ຂອງ service ອື່ນ (ເຊັ່ນ ຕອນປິດ POPR) ແລະ
   * ມອບໃຫ້ຜູ້ໃຊ້ໃນທັນທີ — ບໍ່ເອີ້ນ performAssign/syncStock ເພື່ອບໍ່ໃຫ້ນັບສະຕ໊ອກສອງເທື່ອ
   * (POPR ຈະບວກສະຕ໊ອກຄັ້ງດຽວຕອນປິດ).
   */
  async createAssignedAssetInTx(
    input: {
      type: string;
      catalogItemId: string;
      branchId: string;
      /** ບໍ່ໃສ່ = ເຂົ້າຄັງ (AVAILABLE, ບວກສະຕ໊ອກ); ໃສ່ = ມອບໃຫ້ຜູ້ນີ້ທັນທີ (ASSIGNED) */
      assigneeId?: string;
      /** ສະຖານະທີ່ຕ້ອງການເປັນ (ຈາກ POPR) — ຖ້າບໍ່ໃສ່ ຈະອີງຈາກ assigneeId */
      status?: AssetStatus;
      serialNumber?: string;
      note?: string;
      purchaseDate?: string;
      purchasePrice?: number;
      warrantyExpiry?: string;
    },
    ctx: TxCtx,
    actorId: string,
    ip?: string,
  ): Promise<AssetDocument> {
    const serial = input.serialNumber?.trim();
    if (serial) await this.assertSerialFree(serial, ctx.session);
    // ມີ assignee = ຖືກມອບໝາຍ (ASSIGNED); ບໍ່ມີ = ວ່າງ (AVAILABLE).
    // ຖ້າ POPR ສົ່ງ status ມາ ໃຫ້ສະຖານະນັ້ນຊະນະ — ແຕ່ຫ້າມ "ວ່າງ" ໃນຂະນະທີ່ມີ assignee
    // (ກັນຂໍ້ມູນຂັດແຍ່ງ: ມີຜູ້ຖືແຕ່ບອກວ່າວ່າງ).
    let status =
      input.status &&
      !(input.status === AssetStatus.AVAILABLE && input.assigneeId)
        ? input.status
        : input.assigneeId
          ? AssetStatus.ASSIGNED
          : AssetStatus.AVAILABLE;
    // ຊັບສິນ ASSIGNED ຕ້ອງມີຜູ້ຖື ສະເພາະ — ຖ້າບໍ່ມີຜູ້ຖືໃຫ້ລົງເປັນວ່າງ (AVAILABLE)
    // (ກັນຕາມຂໍ້ມູນຂັດແຍ່ງ: ຊັບສິນວ່າງແຕ່ບໍ່ມີຜູ້ຮັບ/ປະຫວັດການມອບ)
    if (status === AssetStatus.ASSIGNED && !input.assigneeId) {
      status = AssetStatus.AVAILABLE;
    }
    const assignmentHistory =
      input.assigneeId && status !== AssetStatus.AVAILABLE
        ? [
            {
              assigneeId: input.assigneeId,
              assignedAt: new Date(),
              note: input.note,
            },
          ]
        : [];
    const currentAssigneeId =
      status === AssetStatus.AVAILABLE ? undefined : input.assigneeId;
    const maxAttempts = 5;
    for (let attempt = 1; ; attempt++) {
      const tag = await this.generateCatalogAssetTag(
        input.catalogItemId,
        ctx.session,
      );
      const _id = await this.generateId(ctx.session);
      try {
        const saved = await new this.assetModel({
          _id,
          assetTag: tag,
          catalogItemId: input.catalogItemId,
          type: input.type,
          serialNumber: serial || undefined,
          branchId: input.branchId,
          purchaseDate: input.purchaseDate,
          purchasePrice: input.purchasePrice,
          warrantyExpiry: input.warrantyExpiry,
          status,
          currentAssigneeId,
          assignmentHistory,
        }).save({ session: ctx.session });
        if (status === AssetStatus.AVAILABLE) {
          await this.syncStock(
            saved,
            undefined,
            AssetStatus.AVAILABLE,
            actorId,
            ip,
            ctx,
          );
        }
        ctx.audits.push({
          actorId,
          action: 'ASSET_CREATED',
          entityType: 'Asset',
          entityId: String(saved._id),
          before: undefined,
          after: saved.toObject(),
          ip,
        });
        return saved;
      } catch (err: any) {
        const isDuplicate = err?.code === 11000;
        if (!isDuplicate) throw err;
        if (attempt >= maxAttempts) {
          throw new ConflictException(`Asset tag "${tag}" is already in use`);
        }
      }
    }
  }

  private async generateCatalogAssetTag(
    catalogItemId: string,
    session?: ClientSession,
  ): Promise<string> {
    const escapedPrefix = catalogItemId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const prefix = `${catalogItemId}-`;
    const assets = await this.assetModel
      .find(
        { assetTag: new RegExp(`^${escapedPrefix}-\\d+$`, 'i') },
        { assetTag: 1 },
      )
      .session(session ?? null)
      .exec();
    const maxSeq = assets.reduce((m, a) => {
      const n = parseInt(a.assetTag.slice(prefix.length), 10);
      return Number.isFinite(n) && n > m ? n : m;
    }, 0);
    const key = `assetTag:${catalogItemId}`;
    await bumpCounterTo(this.counterModel, key, maxSeq, session);
    const seq = await nextSequence(this.counterModel, key, session);
    return `${catalogItemId}-${String(seq).padStart(3, '0')}`;
  }

  async bulkImport(fileBuffer: Buffer, actorId?: string, ip?: string) {
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
        const hasTag = !!row.assetTag;
        const hasCatalog = !!row.catalogItemId;
        if (!hasTag && !hasCatalog) {
          throw new Error(
            'Missing one or more required fields (assetTag or catalogItemId)',
          );
        }
        if (!row.branchId) {
          throw new Error('Missing required field (branchId)');
        }
        // ຖ້າບໍ່ມີ type ແຕ່ອ້າງ catalog → ໃຊ້ຊື່ລາຍການ catalog ເປັນ type
        let type = row.type;
        if (!type && hasCatalog) {
          const item = await this.catalogService.findOne(row.catalogItemId);
          type = item.name;
        }
        if (!type) {
          throw new Error('Missing required field (type)');
        }
        const dto: CreateAssetDto = {
          assetTag: row.assetTag || undefined,
          catalogItemId: row.catalogItemId || undefined,
          type,
          branchId: row.branchId,
          purchaseDate: row.purchaseDate || undefined,
          warrantyExpiry: row.warrantyExpiry || undefined,
        };
        const created = await this.create(dto, actorId, ip);
        results.push({
          row: rowNumber,
          reference: created.assetTag,
          success: true,
        });
      } catch (error: any) {
        const reference = row.assetTag ?? row.catalogItemId ?? '';
        results.push({
          row: rowNumber,
          reference,
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

  findAll(filters: {
    branchId?: string;
    status?: AssetStatus;
    assigneeId?: string;
  }) {
    const query: any = {};
    if (filters.branchId) query.branchId = filters.branchId;
    if (filters.status) query.status = filters.status;
    if (filters.assigneeId) query.currentAssigneeId = filters.assigneeId;
    return this.assetModel.find(query).exec();
  }

  async findOne(id: string, session?: ClientSession) {
    const asset = await this.assetModel
      .findById(id)
      .session(session ?? null)
      .exec();
    if (!asset) throw new NotFoundException('Asset not found');
    return asset;
  }

  findManyByIds(ids: string[], session?: ClientSession) {
    if (!ids || ids.length === 0) return Promise.resolve([] as AssetDocument[]);
    return this.assetModel
      .find({ _id: { $in: ids } })
      .session(session ?? null)
      .exec();
  }

  /** ຄົ້ນຫາດ້ວຍ Asset Tag ກ່ອນ ຖ້າບໍ່ພົບລອງ _id (QR ຂອງຊັບສິນເປັນລິ້ງ /assets/<_id>) */
  async findByTagOrId(value: string, session?: ClientSession) {
    const byTag = await this.findByAssetTag(value, session);
    if (byTag) return byTag;
    return this.assetModel
      .findById(value)
      .session(session ?? null)
      .exec();
  }

  async findByAssetTag(assetTag: string, session?: ClientSession) {
    const escaped = assetTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.assetModel
      .findOne({ assetTag: new RegExp(`^${escaped}$`, 'i') })
      .session(session ?? null)
      .exec();
  }

  async lookupByTagOrId(identifier: string) {
    const asset = await this.findByTagOrId(identifier);
    if (!asset) throw new NotFoundException(`Asset "${identifier}" not found`);
    return {
      _id: String(asset._id),
      assetTag: asset.assetTag,
      type: asset.type,
      status: asset.status,
      serialNumber: asset.serialNumber,
      catalogItemId: asset.catalogItemId,
    };
  }

  async update(id: string, dto: UpdateAssetDto) {
    const { serialNumber, ...rest } = dto;
    const update: Record<string, any> = { $set: { ...rest } };
    if (serialNumber !== undefined) {
      const sn = String(serialNumber ?? '').trim();
      if (sn) {
        await this.assertSerialFree(sn, undefined, id);
        update.$set.serialNumber = sn;
      } else {
        update.$unset = { serialNumber: 1 };
      }
    }
    try {
      const asset = await this.assetModel
        .findByIdAndUpdate(id, update, { new: true })
        .exec();
      if (!asset) throw new NotFoundException('Asset not found');
      return asset;
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new ConflictException(
          `Serial number "${serialNumber}" is already in use`,
        );
      }
      throw err;
    }
  }

  /** ຫາຊັບສິນດ້ວຍ S/N (ບໍ່ສົນຕົວພິມນ້ອຍ-ໃຫຍ່) */
  async findBySerialNumber(serial: string, session?: ClientSession) {
    const escaped = serial.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.assetModel
      .findOne({ serialNumber: new RegExp(`^${escaped}$`, 'i') })
      .session(session ?? null)
      .exec();
  }

  private async assertSerialFree(
    serial: string,
    session?: ClientSession,
    exceptAssetId?: string,
  ) {
    const dup = await this.findBySerialNumber(serial, session);
    if (dup && String(dup._id) !== String(exceptAssetId)) {
      throw new ConflictException(
        `Serial number "${serial}" is already used by asset ${dup.assetTag}`,
      );
    }
  }

  async assign(id: string, dto: AssignAssetDto, actorId: string, ip?: string) {
    // ແຍກໜ້າທີ່: ຜູ້ມີສິດ assign ມອບຊັບສິນໃຫ້ຕົນເອງບໍ່ໄດ້ (ຕ້ອງໃຫ້ຄົນອື່ນມອບ ຫຼືຜ່ານໃບຂໍທີ່ອະນຸມັດ)
    if ((await sodEnforced()) && String(dto.assigneeId) === String(actorId)) {
      await this.auditLogsService.log(
        actorId,
        'SOD_BLOCKED:ASSET_ASSIGN_SELF',
        'Asset',
        id,
        undefined,
        { blocked: true, action: 'ASSET_ASSIGN_SELF' },
        ip,
      );
      throw new ForbiddenException(
        'Segregation of duties: you cannot assign equipment to yourself',
      );
    }
    return this.inTx(undefined, async (ctx) => {
      const asset = await this.findOne(id, ctx.session);
      return this.performAssign(
        asset,
        dto.assigneeId,
        dto.note,
        actorId,
        ip,
        ctx,
      );
    });
  }

  /**
   * ອ້າງສິດຮັບເຄື່ອງດ້ວຍຕົນເອງ — ຜູ້ໃຊ້ທີ່ກຳລັງ login ຮັບຊັບສິນທີ່ຍັງວ່າງ
   * (ຈາກການສະແກນ QR/ບາໂຄ໊ດ ໃນໜ້າທະບຽນຊັບສິນ) ໂດຍບໍ່ຕ້ອງມີ assets.assign
   */
  /** ມີຊັບສິນ (ທີ່ບໍ່ຖືກປົດ) ຜູກກັບລາຍການ catalog ນີ້ຫຼືບໍ່ — ໃຊ້ແຍກ "ຂອງມີ Asset Tag" ອອກຈາກ "ຂອງໃຊ້ສິ້ນເປືອງ" */
  async hasAssetsForCatalog(catalogItemId?: string): Promise<boolean> {
    if (!catalogItemId) return false;
    const found = await this.assetModel
      .exists({ catalogItemId, status: { $ne: AssetStatus.RETIRED } })
      .exec();
    return !!found;
  }

  // ───────────── Transaction helpers ─────────────

  /** ຮັນໃນ transaction (ຖ້າຜູ້ເອີ້ນຍັງບໍ່ມີ ctx) ແລ້ວບັນທຶກ audit ຫຼັງ commit ສຳເລັດ */
  private async inTx<T>(
    ctx: TxCtx | undefined,
    fn: (ctx: TxCtx) => Promise<T>,
  ): Promise<T> {
    if (ctx) return fn(ctx);
    const audits: AuditEvent[] = [];
    const result = await runInTransaction(this.connection, (session) => {
      audits.length = 0;
      return fn({ session, audits });
    });
    await this.flushAudits(audits);
    return result;
  }

  async flushAudits(audits: AuditEvent[]) {
    for (const e of audits) {
      await this.auditLogsService.log(
        e.actorId,
        e.action,
        e.entityType,
        e.entityId,
        e.before,
        e.after,
        e.ip,
      );
    }
  }

  /**
   * ສະຕ໊ອກ Catalog = ຈຳນວນຊັບສິນ "ວ່າງ" ຂອງລາຍການນັ້ນ — ຂະຫຍັບຕາມສະຖານະຊັບສິນອັດຕະໂນມັດ
   * (ມອບ −1, ຄືນ +1, ສົ່ງສ້ອມ −1, ປົດ −1 ...). ຖ້າສະຕ໊ອກບໍ່ຕົງຈົນຕັດບໍ່ໄດ້ ຈະບໍ່ຕັນການເຮັດວຽກ
   * ແຕ່ບັນທຶກ STOCK_MISMATCH ໃນ audit log ເພື່ອໃຫ້ຜູ້ຮັບຜິດຊອບກວດ.
   */
  private async syncStock(
    asset: { _id: any; assetTag: string; catalogItemId?: string },
    from: AssetStatus | undefined,
    to: AssetStatus | undefined,
    actorId: string,
    ip: string | undefined,
    ctx: TxCtx,
    strict = false,
  ) {
    if (!asset.catalogItemId) return;
    const contrib = (st?: AssetStatus) =>
      st === AssetStatus.AVAILABLE ? 1 : 0;
    const delta = contrib(to) - contrib(from);
    if (delta === 0) return;
    // strict (ໃຊ້ຕອນມອບ): ສະຕ໊ອກຕັດບໍ່ໄດ້ = ບໍ່ມີຂອງໃນຄັງຕາມລະບົບ → ປະຕິເສດ ແທນການຜ່ານແລ້ວແຕ່ບັນທຶກເຕືອນ
    if (strict && delta < 0) {
      const item = await this.catalogService.findOne(
        asset.catalogItemId,
        ctx.session,
      );
      if (item.stockQty < -delta) {
        throw new BadRequestException(
          `ສະຕ໊ອກ "${item.name}" ເປັນ ${item.stockQty} — ບໍ່ມີຂອງໃນຄັງໃຫ້ມອບ. ຖ້າມີຊັບສິນວ່າງຢູ່ຈິງ ໃຫ້ຜູ້ມີສິດກົດ "ຄຳນວນສະຕ໊ອກໃໝ່" ໃນ Catalog`,
        );
      }
    }
    const r = await this.catalogService.adjustStockTracked(
      asset.catalogItemId,
      delta,
      ctx.session,
    );
    if (r.mismatch !== 0) {
      ctx.audits.push({
        actorId,
        action: 'STOCK_MISMATCH',
        entityType: 'SupplyCatalogItem',
        entityId: asset.catalogItemId,
        before: { stockQty: r.stockBefore },
        after: {
          stockQty: r.stockAfter,
          wanted: delta,
          assetTag: asset.assetTag,
          assetId: String(asset._id),
        },
        ip,
      });
    }
  }

  // ───────────── Claim (ສະແກນ QR/ບາໂຄ໊ດ ໃນທະບຽນຊັບສິນ) ─────────────

  /**
   * ຮັບ/ມອບເຄື່ອງດ້ວຍການສະແກນ.
   * - ຜູ້ມີ assets.assign ໃສ່ assigneeCode ເພື່ອມອບໃຫ້ຄົນທີ່ມາຮັບ; ບໍ່ໃສ່ = ຕົນເອງ.
   * - ຜູ້ບໍ່ມີ assets.assign ຮັບໃຫ້ຕົນເອງເທົ່ານັ້ນ.
   * - ຜູ້ຮັບຕ້ອງມີໃບຂໍ APPROVED ທີ່ຍັງມີໂຄຕ້າເຫຼືອສຳລັບຊັບສິນນີ້ (ນັບຕາມຈຳນວນທີ່ຂໍ — ເກີນບໍ່ໄດ້).
   * - ເມື່ອສຳເລັດ ບັນທຶກເຂົ້າໃບຂໍ (receivedAssetIds) ແລະປິດໃບອັດຕະໂນມັດຖ້າລາຍການ Asset Tag ຄົບທຸກລາຍການ.
   * - ທຸກຢ່າງ (ມອບ, ສະຕ໊ອກ, ໃບຂໍ) ຢູ່ໃນ transaction ດຽວ.
   */
  async claim(
    id: string,
    user: PermissionUser,
    note?: string,
    ip?: string,
    assigneeCode?: string,
  ) {
    const actorId = user?.userId;
    if (!actorId) {
      throw new BadRequestException('Not authenticated');
    }
    const canAssign = hasPermission(user, 'assets', 'assign');
    let targetId = actorId;
    let targetIsOther = false;

    const code = assigneeCode?.trim();
    if (code) {
      const target = await this.usersService.findByEmployeeCode(code);
      if (!target) {
        throw new BadRequestException(`Employee code "${code}" not found`);
      }
      if (target.isActive === false) {
        throw new BadRequestException(`Employee code "${code}" is inactive`);
      }
      targetId = String(target._id);
      targetIsOther = targetId !== actorId;
      if (targetIsOther && !canAssign) {
        throw new ForbiddenException(
          'You can only claim equipment for yourself',
        );
      }
    }
    // ຜູ້ມີສິດ assign ຮັບໃຫ້ຕົນເອງໂດຍບໍ່ຕ້ອງມີໃບຂໍໄດ້ ສະເພາະເມື່ອບໍ່ບັງຄັບແຍກໜ້າທີ່ (ໂໝດ dev)
    const needEntitlement =
      !canAssign || targetIsOther || (await sodEnforced());

    return this.inTx(undefined, async (ctx) => {
      const asset = await this.findOne(id, ctx.session);
      if (asset.status === AssetStatus.RETIRED) {
        throw new BadRequestException('Cannot claim a retired asset');
      }
      if (asset.status !== AssetStatus.AVAILABLE) {
        throw new BadRequestException(
          `This asset is not available for claiming (status: ${asset.status})`,
        );
      }

      let hit: Awaited<ReturnType<AssetsService['findEntitlement']>> = null;
      if (needEntitlement) {
        hit = await this.findEntitlement(targetId, asset, ctx.session);
        if (!hit) {
          throw new ForbiddenException(
            targetIsOther
              ? `Employee "${code}" has no approved supply request with remaining quota for this asset`
              : 'You have no approved supply request with remaining quota for this asset',
          );
        }
      }

      const auditNote = targetIsOther
        ? `${note ? note + ' — ' : ''}Handed over by ${actorId} to employee ${code}`
        : note;
      const saved = await this.performAssign(
        asset,
        targetId,
        auditNote,
        actorId,
        ip,
        ctx,
      );
      if (hit) {
        await this.recordReceipt(
          hit.request,
          asset,
          targetId,
          actorId,
          ip,
          ctx,
          hit.counts,
          hit.itemIndex,
        );
      }
      return saved;
    });
  }

  /** ໃບຂໍທີ່ອະນຸມັດແລ້ວ ຂອງຜູ້ຮັບ ທີ່ຍັງມີໂຄຕ້າເຫຼືອສຳລັບຊັບສິນນີ້ (ນັບຊັບສິນທີ່ຮັບໄປແລ້ວຕາມໃບນັ້ນ) */
  private async findEntitlement(
    targetId: string,
    asset: AssetDocument,
    session?: ClientSession,
  ) {
    // ສະຖານະທີ່ຍັງຮັບຂອງບໍ່ຄົບ: APPROVED / ORDERED / PARTIALLY_RECEIVED
    // (CLOSED = ຮັບຄົບແລ້ວ, ບໍ່ມີໂຄຕ້າໃຫ້ຮັບເພີ່ມ)
    const requests = await this.supplyRequestModel
      .find({
        requestedBy: targetId as any,
        status: {
          $in: [
            SupplyRequestStatus.APPROVED,
            SupplyRequestStatus.ORDERED,
            SupplyRequestStatus.PARTIALLY_RECEIVED,
          ],
        },
      })
      .sort({ createdAt: 1 })
      .session(session ?? null)
      .exec();
    for (const r of requests) {
      const prior = await this.findManyByIds(r.receivedAssetIds ?? [], session);
      const counts = r.items.map(() => 0);
      prior.forEach((p) => {
        const k = matchAssetToItem(r.items, p, counts);
        if (k >= 0) counts[k] += 1;
      });
      const k = matchAssetToItem(r.items, asset, counts);
      if (k >= 0 && counts[k] < r.items[k].quantity) {
        return { request: r, itemIndex: k, counts };
      }
    }
    return null;
  }

  /** ບັນທຶກວ່າຊັບສິນນີ້ຖືກຮັບຕາມໃບຂໍ ແລະປິດໃບເມື່ອລາຍການ Asset Tag ຄົບທັງໝົດ */
  private async recordReceipt(
    request: SupplyRequestDocument,
    asset: AssetDocument,
    assigneeId: string,
    actorId: string,
    ip: string | undefined,
    ctx: TxCtx,
    counts: number[],
    itemIndex: number,
  ) {
    const before = request.toObject();
    request.receivedAssetIds = [
      ...(request.receivedAssetIds ?? []),
      String(asset._id),
    ];
    counts[itemIndex] += 1;
    const tagged = await Promise.all(
      request.items.map((i) => this.hasAssetsForCatalog(i.catalogItemId)),
    );
    const complete = request.items.every(
      (it, i) => tagged[i] && counts[i] >= it.quantity,
    );
    if (complete) {
      request.status = SupplyRequestStatus.CLOSED;
      request.fulfilledBy = actorId as any;
      request.fulfilledAt = new Date();
      request.receivedBy = assigneeId as any;
    }
    const saved = await request.save({ session: ctx.session });
    ctx.audits.push({
      actorId,
      action: complete
        ? 'SUPPLY_REQUEST_RECEIVED'
        : 'SUPPLY_REQUEST_PARTIALLY_RECEIVED',
      entityType: 'SupplyRequest',
      entityId: String(request._id),
      before,
      after: saved.toObject(),
      ip,
    });
  }

  // ───────────── Assign / Return / Status / Remove ─────────────

  /** ເປີດໃຫ້ service ອື່ນ (ຮັບເຄື່ອງຕາມໃບຂໍ) ມອບຊັບສິນພາຍໃນ transaction ດຽວກັນ */
  assignInCtx(
    asset: AssetDocument,
    assigneeId: string,
    note: string | undefined,
    actorId: string,
    ip: string | undefined,
    ctx: TxCtx,
  ) {
    return this.performAssign(asset, assigneeId, note, actorId, ip, ctx);
  }

  private async performAssign(
    asset: AssetDocument,
    assigneeId: string,
    note: string | undefined,
    actorId: string,
    ip: string | undefined,
    ctx: TxCtx,
  ) {
    if (asset.status === AssetStatus.RETIRED) {
      throw new BadRequestException('Cannot assign a retired asset');
    }
    // ມອບໄດ້ສະເພາະຊັບສິນ "ວ່າງ" — ຫ້າມມອບຊ້ຳໃຫ້ຄົນອື່ນ ຫຼື ມອບຕອນກຳລັງສ້ອມ
    if (asset.status !== AssetStatus.AVAILABLE) {
      throw new BadRequestException(
        asset.status === AssetStatus.ASSIGNED
          ? `ຊັບສິນ ${asset.assetTag} ຖືກມອບໃຫ້ຜູ້ອື່ນຢູ່ແລ້ວ — ຕ້ອງກົດ "ຄືນເຄື່ອງ" ກ່ອນຈຶ່ງມອບໃໝ່ໄດ້`
          : `ຊັບສິນ ${asset.assetTag} ບໍ່ວ່າງ (ສະຖານະ ${asset.status}) — ມອບບໍ່ໄດ້`,
      );
    }
    const before = asset.toObject();
    const previousStatus = asset.status;
    const wasAssigned = !!asset.currentAssigneeId;

    const now = new Date();
    const openEntry = asset.assignmentHistory.find((h) => !h.returnedAt);
    if (openEntry) {
      openEntry.returnedAt = now;
    }

    asset.assignmentHistory.push({
      assigneeId: assigneeId as any,
      assignedAt: now,
      note,
    });
    asset.currentAssigneeId = assigneeId as any;
    asset.status = AssetStatus.ASSIGNED;
    const saved = await asset.save({ session: ctx.session });

    await this.syncStock(
      asset,
      previousStatus,
      AssetStatus.ASSIGNED,
      actorId,
      ip,
      ctx,
      true,
    );
    ctx.audits.push({
      actorId,
      action: wasAssigned ? 'ASSET_REASSIGNED' : 'ASSET_ASSIGNED',
      entityType: 'Asset',
      entityId: String(asset._id),
      before,
      after: saved.toObject(),
      ip,
    });

    return saved;
  }

  async returnAsset(
    id: string,
    dto: ReturnAssetDto,
    actorId: string,
    ip?: string,
  ) {
    return this.inTx(undefined, async (ctx) => {
      const asset = await this.findOne(id, ctx.session);
      if (asset.status !== AssetStatus.ASSIGNED) {
        throw new BadRequestException('This asset is not currently assigned');
      }
      const before = asset.toObject();

      const openEntry = asset.assignmentHistory.find((h) => !h.returnedAt);
      if (openEntry) {
        openEntry.returnedAt = new Date();
        if (dto.note) openEntry.note = dto.note;
      }
      asset.currentAssigneeId = undefined;
      asset.status = AssetStatus.AVAILABLE;
      const saved = await asset.save({ session: ctx.session });

      await this.syncStock(
        asset,
        AssetStatus.ASSIGNED,
        AssetStatus.AVAILABLE,
        actorId,
        ip,
        ctx,
      );
      ctx.audits.push({
        actorId,
        action: 'ASSET_RETURNED',
        entityType: 'Asset',
        entityId: id,
        before,
        after: saved.toObject(),
        ip,
      });
      return saved;
    });
  }

  async setStatus(
    id: string,
    status: 'AVAILABLE' | 'UNDER_REPAIR' | 'RETIRED',
    actorId: string,
    ip?: string,
  ) {
    const { saved, previousStatus } = await this.inTx(
      undefined,
      async (ctx) => {
        const asset = await this.findOne(id, ctx.session);
        const before = asset.toObject();

        if (asset.status === AssetStatus.ASSIGNED) {
          const openEntry = asset.assignmentHistory.find((h) => !h.returnedAt);
          if (openEntry) openEntry.returnedAt = new Date();
          asset.currentAssigneeId = undefined;
        }

        const prev = asset.status;
        asset.status = status as AssetStatus;
        const savedAsset = await asset.save({ session: ctx.session });

        await this.syncStock(
          asset,
          prev,
          status as AssetStatus,
          actorId,
          ip,
          ctx,
        );
        ctx.audits.push({
          actorId,
          action: 'ASSET_STATUS_CHANGED',
          entityType: 'Asset',
          entityId: id,
          before,
          after: savedAsset.toObject(),
          ip,
        });
        return { saved: savedAsset, previousStatus: prev };
      },
    );

    // ບັນທຶກປະຫວັດການສ້ອມແປງອັດຕະໂມມັດ (ເຮັດຫຼັງ commit ເພື່ອບໍ່ໃຫ້ຊ້ຳເມື່ອ transaction retry):
    // ສົ່ງເຂົ້າ -> ສ້າງບັນທຶກ IN_PROGRESS, ອອກຈາກການສ້ອມແປງ -> ປິດບັນທຶກທີ່ຍັງຄ້າງຢູ່ເປັນ COMPLETED
    if (status === 'UNDER_REPAIR') {
      await this.maintenanceHistoryService.create(
        {
          assetId: saved._id,
          maintenanceDate: new Date().toISOString(),
          status: MaintenanceStatus.IN_PROGRESS,
          previousStatus,
          newStatus: status,
          issue: 'ໄດ້ສົ່ງເຂົ້າການສ້ອມແປງ',
          description: `ສະຖານະຊັບສິນປ່ຽນຈາກ ${previousStatus} ເປັນ ${status}`,
        },
        actorId,
      );
    } else if (String(previousStatus) === 'UNDER_REPAIR') {
      const records = await this.maintenanceHistoryService.findByAssetId(
        saved._id,
      );
      const open = records.find(
        (r) => r.status === MaintenanceStatus.IN_PROGRESS,
      );
      if (open) {
        await this.maintenanceHistoryService.update(String(open._id), {
          status: MaintenanceStatus.COMPLETED,
          completionDate: new Date().toISOString(),
          repairNotes: 'ສ້ອມແປງສຳເລັດແລ້ວ',
        });
      }
    }

    return saved;
  }

  async remove(id: string, actorId: string, ip?: string) {
    return this.inTx(undefined, async (ctx) => {
      const before = await this.findOne(id, ctx.session);

      const result = await this.assetModel
        .findByIdAndDelete(id, { session: ctx.session })
        .exec();
      if (!result) throw new NotFoundException('Asset not found');

      await this.syncStock(before, before.status, undefined, actorId, ip, ctx);
      ctx.audits.push({
        actorId,
        action: 'ASSET_DELETED',
        entityType: 'Asset',
        entityId: id,
        before: before.toObject(),
        after: undefined,
        ip,
      });
      return { deleted: true };
    });
  }

  /**
   * ກວດວ່າຊັບສິນທີ່ POPR ສ້າງ/ມອບ ຍັງ "ບໍ່ຖືກໃຊ້ຕໍ່" ຈຶ່ງຍ້ອນກັບໄດ້ຢ່າງປອດໄພ:
   * ຕ້ອງຍັງ ASSIGNED ໃຫ້ຜູ້ຮັບເດີມ, ມີປະຫວັດການມອບລາຍການດຽວທີ່ຍັງເປີດຢູ່, ແລະບໍ່ມີປະຫວັດບຳລຸງຮັກສາ.
   * ຖ້າບໍ່ຕົງ → ປະຕິເສດທັງໝົດ (ບໍ່ແກ້ໄຂຫຍັງ).
   */
  async assertReversibleByPopr(
    ids: string[],
    expectedAssigneeId: string | undefined,
    ctx: TxCtx,
    opts: { linked?: boolean; stocked?: boolean } = {},
  ) {
    if (!ids || ids.length === 0) return;
    const assets = await this.assetModel
      .find({ _id: { $in: ids } })
      .session(ctx.session ?? null)
      .exec();
    const problems: string[] = [];
    for (const a of assets) {
      const reasons: string[] = [];
      const history = a.assignmentHistory ?? [];
      if (opts.stocked) {
        // ຢູ່ຄັງແລ້ວ ຍັງບໍ່ມີໃຜເບີກ: ຕ້ອງບໍ່ຖືກມອບ (ບໍ່ມີຜູ້ຖື) ແລະ ບໍ່ເຄີຍຖືກມອບ
        // ສະຖານະອາດເປັນ AVAILABLE/UNDER_REPAIR/RETIRED ໄດ້ ຕາມທີ່ຜູ້ໃຊ້ເລືອກ
        if (a.currentAssigneeId || a.status === AssetStatus.ASSIGNED)
          reasons.push(`ມີຜູ້ຖື (${a.status})`);
        if (history.length > 0) reasons.push('ເຄີຍຖືກມອບແລ້ວ');
      } else {
        if (a.status !== AssetStatus.ASSIGNED)
          reasons.push(`ສະຖານະ ${a.status}`);
        if (
          !expectedAssigneeId ||
          String(a.currentAssigneeId ?? '') !== String(expectedAssigneeId)
        ) {
          reasons.push('ຜູ້ຖືປັດຈຸບັນບໍ່ແມ່ນຜູ້ຮັບເດີມ');
        }
        const openCount = history.filter((h) => !h.returnedAt).length;
        if (openCount !== 1) reasons.push('ປະຫວັດການມອບບໍ່ຕົງ');
        // ຊັບສິນທີ່ POPR ສ້າງເອງມີປະຫວັດໄດ້ແຕ່ລາຍການດຽວ; ຊັບສິນທີ່ຜູກມາຈາກທະບຽນມີປະຫວັດເກົ່າໄດ້
        if (!opts.linked && history.length !== 1)
          reasons.push('ມີປະຫວັດການມອບຫຼາຍຄັ້ງ');
      }
      const maintenance = await this.maintenanceHistoryService.findByAssetId(
        String(a._id),
      );
      if (maintenance.length > 0) reasons.push('ມີປະຫວັດບຳລຸງຮັກສາ');
      if (reasons.length > 0)
        problems.push(`${a.assetTag}: ${reasons.join(', ')}`);
    }
    if (problems.length > 0) {
      throw new BadRequestException(
        `ຍ້ອນກັບບໍ່ໄດ້ ເພາະຊັບສິນຖືກນຳໃຊ້ແລ້ວ — ${problems.join(' | ')}`,
      );
    }
  }

  /**
   * ລຶບຊັບສິນພາຍໃນ transaction ຂອງ service ອື່ນ (ເຊັ່ນ ຍ້ອນກັບຕອນເປີດ POPR ໃໝ່).
   * ກວດ assertReversibleByPopr ກ່ອນລຶບສະເໝີ. ຊັບສິນເຫຼົ່ານີ້ຢູ່ສະຖານະ ASSIGNED
   * (ບໍ່ນັບເຂົ້າສະຕ໊ອກ) ຈຶ່ງບໍ່ຕ້ອງ syncStock.
   */
  async deleteAssetsInTx(
    ids: string[],
    expectedAssigneeId: string | undefined,
    ctx: TxCtx,
    actorId: string,
    ip?: string,
    opts: { stocked?: boolean } = {},
  ): Promise<number> {
    if (!ids || ids.length === 0) return 0;
    await this.assertReversibleByPopr(ids, expectedAssigneeId, ctx, opts);
    const assets = await this.assetModel
      .find({ _id: { $in: ids } })
      .session(ctx.session ?? null)
      .exec();
    for (const asset of assets) {
      await this.assetModel
        .deleteOne({ _id: asset._id }, { session: ctx.session })
        .exec();
      if (opts.stocked) {
        await this.syncStock(asset, asset.status, undefined, actorId, ip, ctx);
      }
      ctx.audits.push({
        actorId,
        action: 'ASSET_DELETED',
        entityType: 'Asset',
        entityId: String(asset._id),
        before: asset.toObject(),
        after: undefined,
        ip,
      });
    }
    return assets.length;
  }

  /** ຍ້ອນກັບການມອບຊັບສິນເດີມ (ທີ່ POPR ມອບ) ກັບເປັນວ່າງ ພາຍໃນ transaction ຂອງ service ອື່ນ */
  async unassignLinkedInTx(
    ids: string[],
    expectedAssigneeId: string | undefined,
    note: string,
    ctx: TxCtx,
    actorId: string,
    ip?: string,
  ) {
    if (!ids || ids.length === 0) return;
    await this.assertReversibleByPopr(ids, expectedAssigneeId, ctx, {
      linked: true,
    });
    for (const id of ids) {
      const asset = await this.findOne(id, ctx.session);
      const before = asset.toObject();
      const open = asset.assignmentHistory.find((h) => !h.returnedAt);
      if (open) {
        open.returnedAt = new Date();
        open.note = open.note ? `${open.note} · ${note}` : note;
      }
      asset.currentAssigneeId = undefined;
      asset.status = AssetStatus.AVAILABLE;
      const saved = await asset.save({ session: ctx.session });
      await this.syncStock(
        asset,
        AssetStatus.ASSIGNED,
        AssetStatus.AVAILABLE,
        actorId,
        ip,
        ctx,
      );
      ctx.audits.push({
        actorId,
        action: 'ASSET_RETURNED',
        entityType: 'Asset',
        entityId: id,
        before,
        after: saved.toObject(),
        ip,
      });
    }
  }

  async findOverdueReturns() {
    return this.assetModel.aggregate([
      {
        $match: {
          status: AssetStatus.ASSIGNED,
          currentAssigneeId: { $exists: true },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'currentAssigneeId',
          foreignField: '_id',
          as: 'assignee',
        },
      },
      { $unwind: '$assignee' },
      { $match: { 'assignee.isActive': false } },
      {
        $project: {
          assetTag: 1,
          type: 1,
          branchId: 1,
          currentAssigneeId: 1,
          'assignee.email': 1,
          'assignee.isActive': 1,
        },
      },
    ]);
  }
}
