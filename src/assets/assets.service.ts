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
import {
  Asset,
  AssetDocument,
  AssetStatus,
  HolderType,
} from './schemas/asset.schema';
import {
  Department,
  DepartmentDocument,
} from '../departments/schemas/department.schema';
import { AssignDepartmentDto } from './dto/assign-department.dto';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { AssignAssetDto } from './dto/assign-asset.dto';
import { ReturnAssetDto } from './dto/return-asset.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { MaintenanceHistoryService } from '../maintenance-history/maintenance-history.service';
import { MaintenanceStatus } from '../maintenance-history/schemas/maintenance-history.schema';
import { SupplyCatalogService } from '../supply-catalog/supply-catalog.service';
import { CatalogItemType } from '../supply-catalog/schemas/supply-catalog-item.schema';
import { catalogCanCreateAsset, catalogRequiresAssetTag } from '../common/utils/catalog-item-type.util';
import {
  SupplyRequest,
  SupplyRequestDocument,
  SupplyRequestStatus,
  SupplyLineStatus,
} from '../supply-requests/schemas/supply-request.schema';
import {
  deriveSupplyStatus,
  isLineTracked,
  lineStatusOf,
} from '../common/utils/supply-line-status.util';
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
    @InjectModel(Department.name)
    private departmentModel: Model<DepartmentDocument>,
    @InjectConnection() private connection: Connection,
  ) {}

  private async generateId(session?: ClientSession): Promise<string> {
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

    if (catalogItemId) {
      const catalogItem = await this.catalogService.findOne(catalogItemId, session);
      const legacyHasAssets = catalogItem.itemType
        ? false
        : await this.catalogHasAssets(String(catalogItemId), session);
      if (!catalogCanCreateAsset(catalogItem.itemType, legacyHasAssets)) {
        const reason = catalogItem.itemType === CatalogItemType.CONSUMABLE
          ? 'ເປັນວັດສະດຸສິ້ນເປືອງ'
          : 'ຍັງບໍ່ໄດ້ກຳນົດ itemType ແລະບໍ່ມີຊັບສິນເກົ່າຜູກຢູ່';
        throw new BadRequestException(
          `ບໍ່ສາມາດສ້າງຊັບສິນຈາກ Catalog "${catalogItem.name}" ໄດ້ — ${reason}. ກະລຸນາກຳນົດໃຫ້ເປັນ ASSET ກ່ອນ`,
        );
      }
    }

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

    if (!catalogItemId) {
      throw new BadRequestException(
        'Provide an assetTag or select a catalog item so the system can auto-generate one (e.g. SC002-001)',
      );
    }

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

  async createAssignedAssetInTx(
    input: {
      type: string;
      catalogItemId: string;
      branchId: string;
      assigneeId?: string;
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
    let status =
      input.status &&
      !(input.status === AssetStatus.AVAILABLE && input.assigneeId)
        ? input.status
        : input.assigneeId
          ? AssetStatus.ASSIGNED
          : AssetStatus.AVAILABLE;
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
    departmentId?: string;
    holderType?: HolderType;
    catalogItemId?: string;
  }) {
    const query: any = {};
    if (filters.catalogItemId) query.catalogItemId = filters.catalogItemId;
    if (filters.departmentId) query.departmentId = filters.departmentId;
    if (filters.holderType === HolderType.DEPARTMENT) {
      query.holderType = HolderType.DEPARTMENT;
    } else if (filters.holderType === HolderType.PERSON) {
      query.holderType = { $ne: HolderType.DEPARTMENT };
    }
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

  async getTimeline(id: string) {
    const asset = await this.findOne(id);
    const obj = asset.toObject() as any;

    const toId = (v: any) =>
      v && typeof v === 'object' ? String(v._id ?? v.id ?? v) : v ? String(v) : '';

    const GoodsReceiptModel: Model<any> | undefined =
      this.connection.models['GoodsReceipt'];
    const receipts = GoodsReceiptModel
      ? await GoodsReceiptModel.find({ assetIds: id }).sort({ receivedDate: 1 }).lean().exec()
      : [];
    const audits = (await this.auditLogsService.findAll({
      entityType: 'Asset',
      entityId: id,
    })) as any[];
    const maintenance = (await this.maintenanceHistoryService.findByAssetId(id)) as any[];
    const history: any[] = obj.assignmentHistory ?? [];

    const userIds = new Set<string>();
    const addUser = (v: any) => {
      const u = toId(v);
      if (u) userIds.add(u);
    };
    history.forEach((h) => {
      addUser(h.assigneeId);
      addUser(h.receivedById);
    });
    receipts.forEach((r: any) => addUser(r.createdBy));
    addUser(obj.currentAssigneeId);
    audits.forEach((a) => addUser(a.actorId));
    const UserModel: Model<any> | undefined = this.connection.models['User'];
    const users = UserModel && userIds.size
      ? await UserModel.find({ _id: { $in: [...userIds] } })
          .select('firstName lastName employeeCode')
          .lean()
          .exec()
      : [];
    const userMap = new Map<string, { id: string; name: string; code?: string }>(
      (users as any[]).map((u): [string, { id: string; name: string; code?: string }] => [
        String(u._id),
        {
          id: String(u._id),
          name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || String(u._id),
          code: u.employeeCode,
        },
      ]),
    );
    const who = (v: any) => {
      const key = toId(v);
      return key ? (userMap.get(key) ?? { id: key, name: key }) : undefined;
    };
    const deptIds = [...new Set(history.map((h) => h.departmentId).filter(Boolean))];
    if (obj.departmentId) deptIds.push(obj.departmentId);
    const depts = deptIds.length
      ? await this.departmentModel.find({ _id: { $in: deptIds } }).select('name').lean().exec()
      : [];
    const deptMap = new Map<string, string>((depts as any[]).map((d): [string, string] => [String(d._id), d.name]));
    const deptName = (v?: string) => (v ? (deptMap.get(String(v)) ?? String(v)) : undefined);

    const WINDOW_MS = 2 * 60 * 1000;
    const actorNear = (actions: string[], at?: Date | string) => {
      if (!at) return undefined;
      const t = new Date(at).getTime();
      let best: any;
      let bestDiff = Infinity;
      for (const a of audits) {
        if (!actions.includes(a.action)) continue;
        const diff = Math.abs(new Date(a.timestamp).getTime() - t);
        if (diff < bestDiff) {
          best = a;
          bestDiff = diff;
        }
      }
      return best && bestDiff <= WINDOW_MS ? who(best.actorId) : undefined;
    };

    type Ev = {
      type: string;
      at: Date | string;
      actor?: { id: string; name: string; code?: string };
      holder?: { id: string; name: string; code?: string };
      receivedBy?: { id: string; name: string; code?: string };
      department?: string;
      note?: string;
      detail?: Record<string, any>;
    };
    const events: Ev[] = [];

    for (const r of receipts as any[]) {
      events.push({
        type: 'RECEIVED',
        at: r.receivedDate ?? r.createdAt,
        actor: who(r.createdBy),
        note: r.note || undefined,
        detail: {
          receiptNo: r.receiptNo,
          vendor: r.vendor,
          invoiceNo: r.invoiceNo,
          unitPrice: r.unitPrice,
          purchaseRequestNo: r.purchaseRequestNo,
          storageRoom: r.storageRoom,
          mode: r.mode,
        },
      });
    }
    if (receipts.length === 0) {
      const created = [...audits].reverse().find((a) => a.action === 'ASSET_CREATED');
      events.push({
        type: 'CREATED',
        at: created?.timestamp ?? obj.createdAt,
        actor: created ? who(created.actorId) : undefined,
        detail: {
          purchaseDate: obj.purchaseDate,
          purchasePrice: obj.purchasePrice,
        },
      });
    }

    for (const h of history) {
      events.push({
        type: h.departmentId ? 'ASSIGNED_DEPT' : 'ASSIGNED',
        at: h.assignedAt,
        actor: actorNear(
          ['ASSET_ASSIGNED', 'ASSET_REASSIGNED', 'ASSET_ASSIGNED_DEPT', 'ASSET_CLAIMED'],
          h.assignedAt,
        ),
        holder: who(h.assigneeId),
        receivedBy: who(h.receivedById),
        department: deptName(h.departmentId),
        note: h.note || undefined,
      });
      if (h.returnedAt) {
        events.push({
          type: 'RETURNED',
          at: h.returnedAt,
          actor: actorNear(['ASSET_RETURNED', 'ASSET_REASSIGNED'], h.returnedAt),
          holder: who(h.assigneeId),
          department: deptName(h.departmentId),
        });
      }
    }

    for (const m of maintenance) {
      events.push({
        type: 'REPAIR',
        at: m.maintenanceDate ?? m.createdAt,
        actor: who(m.recordedBy),
        detail: {
          status: m.status,
          issue: m.issue,
          description: m.description,
          repairNotes: m.repairNotes,
          cost: m.cost,
          completionDate: m.completionDate,
          technician: m.technicianId
            ? `${m.technicianId.firstName ?? ''} ${m.technicianId.lastName ?? ''}`.trim()
            : undefined,
        },
      });
    }

    for (const a of audits) {
      if (a.action !== 'ASSET_STATUS_CHANGED') continue;
      const from = a.before?.status;
      const to = a.after?.status;
      if (maintenance.length > 0 && (to === 'UNDER_REPAIR' || from === 'UNDER_REPAIR')) continue;
      events.push({
        type: 'STATUS_CHANGED',
        at: a.timestamp,
        actor: who(a.actorId),
        detail: { from, to },
      });
    }

    events.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());

    return {
      assetId: obj._id,
      assetTag: obj.assetTag,
      status: obj.status,
      currentHolder: who(obj.currentAssigneeId),
      currentDepartment: deptName(obj.departmentId),
      firstReceivedAt: receipts[0]
        ? ((receipts[0] as any).receivedDate ?? (receipts[0] as any).createdAt)
        : obj.createdAt,
      events,
    };
  }

  findManyByIds(ids: string[], session?: ClientSession) {
    if (!ids || ids.length === 0) return Promise.resolve([] as AssetDocument[]);
    return this.assetModel
      .find({ _id: { $in: ids } })
      .session(session ?? null)
      .exec();
  }

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

  async catalogHasAssets(catalogItemId: string, session?: ClientSession) {
    const hit = await this.assetModel
      .exists({ catalogItemId, status: { $ne: AssetStatus.RETIRED } })
      .session(session ?? null);
    return !!hit;
  }

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

  async assignToDepartment(
    id: string,
    dto: AssignDepartmentDto,
    actorId: string,
    ip?: string,
  ) {
    const dept = await this.departmentModel.findById(dto.departmentId).exec();
    if (!dept || dept.isActive === false) {
      throw new BadRequestException('ບໍ່ພົບພະແນກ ຫຼືພະແນກຖືກປິດໃຊ້ງານ');
    }
    if (!String(dept.branchId ?? '').trim()) {
      throw new BadRequestException('ພະແນກນີ້ບໍ່ໄດ້ກຳນົດສາຂາ');
    }
    const belongsToDept = async (userId: string, label: string) => {
      const u = await this.usersService.findOneRaw(userId);
      if (u.isActive === false) {
        throw new BadRequestException(`${label}: ບັນຊີຖືກປິດໃຊ້ງານແລ້ວ`);
      }
      const inDept = String(u.departmentId ?? '') === String(dept._id);
      const isManager = (dept.managerIds ?? [])
        .map(String)
        .includes(String(u._id));
      if (!inDept && !isManager) {
        throw new BadRequestException(
          `${label} ຕ້ອງເປັນຫົວໜ້າ ຫຼືພະນັກງານຂອງພະແນກ "${dept.name}"`,
        );
      }
      return u;
    };
    await belongsToDept(dto.custodianId, 'ຜູ້ຮັບຜິດຊອບ');
    const receivedById =
      dto.receivedById && String(dto.receivedById) !== String(dto.custodianId)
        ? dto.receivedById
        : undefined;
    if (receivedById) await belongsToDept(receivedById, 'ຜູ້ຮັບແທນ');

    if (await sodEnforced()) {
      const self =
        String(dto.custodianId) === String(actorId) ||
        (receivedById && String(receivedById) === String(actorId));
      if (self) {
        await this.auditLogsService.log(
          actorId,
          'SOD_BLOCKED:ASSET_ASSIGN_DEPT_SELF',
          'Asset',
          id,
          undefined,
          { blocked: true, action: 'ASSET_ASSIGN_DEPT_SELF' },
          ip,
        );
        throw new ForbiddenException(
          'ແຍກໜ້າທີ່: ຜູ້ມອບເຄື່ອງບໍ່ສາມາດເປັນຜູ້ຮັບຜິດຊອບ ຫຼືຜູ້ຮັບແທນຂອງຕົນເອງໄດ້',
        );
      }
    }
    return this.inTx(undefined, async (ctx) => {
      const asset = await this.findOne(id, ctx.session);
      return this.performAssign(
        asset,
        dto.custodianId,
        dto.note,
        actorId,
        ip,
        ctx,
        {
          departmentId: String(dept._id),
          branchId: String(dept.branchId ?? ''),
          receivedById,
        },
      );
    });
  }

  async requiresAssetTagForCatalog(
    catalogItemId?: string,
    session?: ClientSession,
  ): Promise<boolean> {
    if (!catalogItemId) return false;
    const item = await this.catalogService.findOne(String(catalogItemId), session);
    const legacyHasAssets = item.itemType
      ? false
      : await this.catalogHasAssets(String(catalogItemId), session);
    return catalogRequiresAssetTag(item.itemType, legacyHasAssets);
  }

  async hasAssetsForCatalog(catalogItemId?: string): Promise<boolean> {
    if (!catalogItemId) return false;
    const found = await this.assetModel
      .exists({ catalogItemId, status: { $ne: AssetStatus.RETIRED } })
      .exec();
    return !!found;
  }


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
      const reservedFor =
        asset.reservedForRequestId &&
        hit &&
        String(hit.request._id) === asset.reservedForRequestId
          ? asset.reservedForRequestId
          : undefined;
      const saved = await this.performAssign(
        asset,
        targetId,
        auditNote,
        actorId,
        ip,
        ctx,
        undefined,
        reservedFor,
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

  private async findEntitlement(
    targetId: string,
    asset: AssetDocument,
    session?: ClientSession,
  ) {
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
      const lineMode = isLineTracked(r.items);
      if (
        !lineMode &&
        r.items.some(
          (i) => !!i.purchaseRequestId && (i.arrivedQty ?? 0) < (i.purchaseQty ?? 0),
        )
      ) {
        continue;
      }
      const prior = await this.findManyByIds(r.receivedAssetIds ?? [], session);
      const counts = r.items.map(() => 0);
      prior.forEach((p) => {
        const k = matchAssetToItem(r.items, p, counts);
        if (k >= 0) counts[k] += 1;
      });
      const pool = r.items
        .map((_, idx) => idx)
        .filter(
          (idx) => !lineMode || lineStatusOf(r.items[idx]) === SupplyLineStatus.READY,
        );
      const poolItems = pool.map((idx) => r.items[idx]);
      const poolCounts = pool.map((idx) => counts[idx]);
      const j = matchAssetToItem(poolItems, asset, poolCounts);
      if (j >= 0 && poolCounts[j] < poolItems[j].quantity) {
        return { request: r, itemIndex: pool[j], counts };
      }
    }
    return null;
  }

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
      request.items.map((i) =>
        this.requiresAssetTagForCatalog(i.catalogItemId, ctx.session),
      ),
    );
    let complete: boolean;
    if (isLineTracked(request.items)) {
      const line = request.items[itemIndex];
      if (tagged[itemIndex] && counts[itemIndex] >= line.quantity) {
        line.lineStatus = SupplyLineStatus.COLLECTED;
        line.lineUpdatedBy = actorId as any;
        line.lineUpdatedAt = new Date();
        request.markModified('items');
      }
      request.status = deriveSupplyStatus(request.items);
      if (!request.items.some((i) => lineStatusOf(i) === SupplyLineStatus.READY)) {
        request.readyToCollectAt = undefined;
      }
      complete = request.status === SupplyRequestStatus.CLOSED;
    } else {
      complete = request.items.every(
        (it, i) => tagged[i] && counts[i] >= it.quantity,
      );
    }
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


  assignInCtx(
    asset: AssetDocument,
    assigneeId: string,
    note: string | undefined,
    actorId: string,
    ip: string | undefined,
    ctx: TxCtx,
    dept?: { departmentId: string; branchId: string; receivedById?: string },
    reservedFor?: string,
  ) {
    return this.performAssign(
      asset,
      assigneeId,
      note,
      actorId,
      ip,
      ctx,
      dept,
      reservedFor,
    );
  }

  async reserveForRequestInTx(
    assetIds: string[],
    requestId: string,
    session?: ClientSession,
  ) {
    if (assetIds.length === 0) return 0;
    const res = await this.assetModel
      .updateMany(
        {
          _id: { $in: assetIds },
          status: AssetStatus.AVAILABLE,
          reservedForRequestId: { $exists: false },
        },
        { $set: { reservedForRequestId: requestId } },
        { session },
      )
      .exec();
    return res.modifiedCount ?? 0;
  }

  async findFreeAssetIds(catalogItemId: string, limit: number): Promise<string[]> {
    const docs = await this.assetModel
      .find({
        catalogItemId,
        status: AssetStatus.AVAILABLE,
        reservedForRequestId: { $exists: false },
      })
      .sort({ createdAt: 1 })
      .limit(limit)
      .select('_id')
      .lean()
      .exec();
    return docs.map((d: any) => String(d._id));
  }

  countFreeAssets(catalogItemId: string) {
    return this.assetModel
      .countDocuments({
        catalogItemId,
        status: AssetStatus.AVAILABLE,
        reservedForRequestId: { $exists: false },
      })
      .exec();
  }

  async releaseReservationsForRequest(
    requestId: string,
    session?: ClientSession,
    catalogItemIds?: string[],
  ) {
    if (catalogItemIds && catalogItemIds.length === 0) return;
    await this.assetModel
      .updateMany(
        {
          reservedForRequestId: requestId,
          ...(catalogItemIds ? { catalogItemId: { $in: catalogItemIds } } : {}),
        },
        { $unset: { reservedForRequestId: 1 } },
        { session },
      )
      .exec();
  }

  countReservedForRequest(requestId: string, session?: ClientSession) {
    return this.assetModel
      .countDocuments({ reservedForRequestId: requestId, status: AssetStatus.AVAILABLE })
      .session(session ?? null)
      .exec();
  }

  private async performAssign(
    asset: AssetDocument,
    assigneeId: string,
    note: string | undefined,
    actorId: string,
    ip: string | undefined,
    ctx: TxCtx,
    dept?: { departmentId: string; branchId: string; receivedById?: string },
    reservedFor?: string,
  ) {
    if (asset.status === AssetStatus.RETIRED) {
      throw new BadRequestException('Cannot assign a retired asset');
    }
    if (asset.reservedForRequestId && asset.reservedForRequestId !== reservedFor) {
      throw new BadRequestException(
        `ຊັບສິນ ${asset.assetTag} ຖືກຈອງໄວ້ສຳລັບຄຳຂໍເບີກ ${asset.reservedForRequestId} — ມອບໃຫ້ຄົນອື່ນບໍ່ໄດ້`,
      );
    }
    if (asset.status !== AssetStatus.AVAILABLE) {
      throw new BadRequestException(
        asset.status === AssetStatus.ASSIGNED
          ? `ຊັບສິນ ${asset.assetTag} ຖືກມອບໃຫ້ຜູ້ອື່ນຢູ່ແລ້ວ — ຕ້ອງກົດ "ຄືນເຄື່ອງ" ກ່ອນຈຶ່ງມອບໃໝ່ໄດ້`
          : `ຊັບສິນ ${asset.assetTag} ບໍ່ວ່າງ (ສະຖານະ ${asset.status}) — ມອບບໍ່ໄດ້`,
      );
    }
    if (dept) {
      const assetBranchId = String(asset.branchId ?? '').trim();
      const departmentBranchId = String(dept.branchId ?? '').trim();
      if (!assetBranchId || !departmentBranchId || assetBranchId !== departmentBranchId) {
        throw new BadRequestException(
          `ສາຂາຂອງຊັບສິນ ${asset.assetTag} (${assetBranchId || 'ບໍ່ລະບຸ'}) ບໍ່ກົງກັບສາຂາຂອງພະແນກ (${departmentBranchId || 'ບໍ່ລະບຸ'}) — ບໍ່ອະນຸຍາດມອບຂ້າມສາຂາ`,
        );
      }
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
      ...(dept
        ? {
            departmentId: dept.departmentId,
            receivedById: dept.receivedById as any,
          }
        : {}),
    });
    asset.currentAssigneeId = assigneeId as any;
    asset.holderType = dept ? HolderType.DEPARTMENT : HolderType.PERSON;
    asset.departmentId = dept ? dept.departmentId : undefined;
    asset.status = AssetStatus.ASSIGNED;
    asset.reservedForRequestId = undefined;
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
      action: dept
        ? 'ASSET_ASSIGNED_DEPT'
        : wasAssigned
          ? 'ASSET_REASSIGNED'
          : 'ASSET_ASSIGNED',
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
      asset.holderType = HolderType.PERSON;
      asset.departmentId = undefined;
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
          asset.holderType = HolderType.PERSON;
          asset.departmentId = undefined;
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
