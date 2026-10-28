import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import {
  SupplyRequest,
  SupplyRequestDocument,
  SupplyRequestStatus,
} from './schemas/supply-request.schema';
import { CreateSupplyRequestDto } from './dto/create-supply-request.dto';
import { ReceiveSupplyRequestDto } from './dto/receive-supply-request.dto';
import { SetSupplyRequestDelegateDto } from './dto/set-supply-request-delegate.dto';
import { SupplyCatalogService } from '../supply-catalog/supply-catalog.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { UsersService } from '../users/users.service';
import { DepartmentsService } from '../departments/departments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AssetsService } from '../assets/assets.service';
import { AssetDocument, AssetStatus } from '../assets/schemas/asset.schema';
import {
  hasAnyPermission,
  hasPermission,
  PermissionUser,
} from '../common/utils/permission.util';
import {
  AuditEvent,
  runInTransaction,
  TxCtx,
} from '../common/utils/transaction.util';
import { sodEnforced } from '../common/utils/sod.util';
import { matchAssetToItem } from '../common/utils/supply-match.util';

/**
 * ສະຖານະທີ່ "ເປີດ" — ອະນຸມັດແລ້ວ ແລະ ຍັງຮັບຂອງບໍ່ຄົບ.
 * ທັງສອງ flow (scan/fulfill) ແລະ flow ຮັບຂອງແລ້ວ ຕ້ອງສາມາດເຮັດວຽກໄດ້ໃນສະຖານະເຫຼົ່າເຫຼົ່ມ.
 */
const OPEN_STATUSES: SupplyRequestStatus[] = [
  SupplyRequestStatus.APPROVED,
  SupplyRequestStatus.ORDERED,
  SupplyRequestStatus.PARTIALLY_RECEIVED,
];

@Injectable()
export class SupplyRequestsService {
  constructor(
    @InjectModel(SupplyRequest.name)
    private requestModel: Model<SupplyRequestDocument>,
    private catalogService: SupplyCatalogService,
    private auditLogsService: AuditLogsService,
    private usersService: UsersService,
    private departmentsService: DepartmentsService,
    private assetsService: AssetsService,
    @InjectConnection() private connection: Connection,
    private notificationsService: NotificationsService,
  ) {}

  private async generateId(): Promise<string> {
    // ຈັບ id ທັງໝົດ (SR001, SR1000, ...) — regex ທີ່ລະດັບ 3 ຫລຢາງເຮັດໃຫ້ id ຊ່ຳໃນເວລາ SR1000+
    const requests = await this.requestModel
      .find({ _id: /^SR\d+$/ }, { _id: 1 })
      .sort({ _id: 1 })
      .exec();
    const usedNumbers = new Set(
      requests.map((r) => parseInt(r._id.slice(2), 10)),
    );
    let seq = 1;
    while (usedNumbers.has(seq)) seq++;
    return `SR${String(seq).padStart(3, '0')}`;
  }

  /**
   * ກວດ ແລະ ແປງຂໍ້ມູນພະແນກ/ຜູ້ຮັບຜິດຊອບ ສຳລັບໃບຂໍທີ່ຂໍໃນນາມພະແນກ.
   * ຜູ້ຂໍ ແລະ ຜູ້ຮັບຜິດຊອບ ຕ້ອງເປັນສະມາຊິກ ຫຼື ຫົວໜ້າຂອງພະແນກນັ້ນ.
   */
  private async resolveDepartmentAssignment(
    dto: CreateSupplyRequestDto,
    requestedBy: string,
  ): Promise<{ departmentId: string; custodianId: string } | undefined> {
    if (!dto.departmentId) {
      if (dto.custodianId || dto.custodianCode) {
        throw new BadRequestException('custodian ໃຊ້ໄດ້ສະເພາະໃບຂໍຂອງພະແນກ');
      }
      return undefined;
    }

    const department = await this.departmentsService.findOne(dto.departmentId);
    if (!department || department.isActive === false) {
      throw new BadRequestException('ພະແນກບໍ່ພົບ ຫຼື ຖືກປິດໃຊ້ງານ');
    }
    const managerIds = (department.managerIds ?? []).map(String);

    const requester = await this.usersService.findOneRaw(requestedBy);
    if (requester.isActive === false) {
      throw new BadRequestException('ບັນຊີຜູ້ຂໍຖືກປິດໃຊ້ງານແລ້ວ');
    }
    const requesterInDept =
      String(requester.departmentId ?? '') === String(department._id);
    if (!requesterInDept && !managerIds.includes(String(requester._id))) {
      throw new BadRequestException(
        `ຂໍໃນນາມພະແນກໄດ້ສະເພາະສະມາຊິກ ຫຼື ຫົວໜ້າພະແນກ "${department.name}"`,
      );
    }

    if (!dto.custodianId && !dto.custodianCode?.trim()) {
      throw new BadRequestException('ຕ້ອງລະບຸຜູ້ຮັບຜິດຊອບຂອງພະແນກ');
    }
    const custodian = dto.custodianId
      ? await this.usersService.findOneRaw(dto.custodianId)
      : await this.usersService.findByEmployeeCode(dto.custodianCode!.trim());
    if (!custodian) {
      throw new BadRequestException('ບໍ່ພົບຜູ້ຮັບຜິດຊອບຕາມລະຫັດທີ່ລະບຸ');
    }
    if (custodian.isActive === false) {
      throw new BadRequestException('ບັນຊີຜູ້ຮັບຜິດຊອບຖືກປິດໃຊ້ງານແລ້ວ');
    }
    const custodianInDept =
      String(custodian.departmentId ?? '') === String(department._id);
    if (!custodianInDept && !managerIds.includes(String(custodian._id))) {
      throw new BadRequestException(
        `ຜູ້ຮັບຜິດຊອບຕ້ອງເປັນສະມາຊິກ ຫຼື ຫົວໜ້າພະແນກ "${department.name}"`,
      );
    }

    return {
      departmentId: String(department._id),
      custodianId: String(custodian._id),
    };
  }

  /**
   * ກວດ ແລະ ແປງລະຫັດພະນັກງານຂອງຜູ້ຮັບແທນ (delegate) ເປັນ users._id.
   * - ຕ້ອງມີຢູ່ ແລະ ຍັງໃຊ້ງານ; ຜູ້ຂໍບໍ່ຕ້ອງຕັ້ງຕົນເອງເປັນຜູ້ຮັບແທນ
   * - ໃບຂອງແຜນກ: ຜູ້ຮັບແທນຕ້ອງເປັນສະມາຊິກ ຫຼື ຫົວໜ້າຂອງແຜນກ (ກົດດຽວກັບ assigneeCode)
   */
  private async resolveDelegate(
    code: string,
    requesterId: string,
    departmentId?: string,
  ): Promise<string> {
    const delegate = await this.usersService.findByEmployeeCode(code.trim());
    if (!delegate) {
      throw new BadRequestException(`Employee code "${code}" not found`);
    }
    if (delegate.isActive === false) {
      throw new BadRequestException(`Employee code "${code}" is inactive`);
    }
    const delegateId = String(delegate._id);
    if (delegateId === requesterId) {
      throw new BadRequestException(
        'The requester cannot be their own delegate — the requester can already collect',
      );
    }
    if (departmentId) {
      const department = await this.departmentsService.findOne(departmentId);
      const managerIds = (department?.managerIds ?? []).map(String);
      const inDepartment = String(delegate.departmentId ?? '') === departmentId;
      if (!inDepartment && !managerIds.includes(delegateId)) {
        throw new BadRequestException(
          'ຜູ້ຮັບແທນຕ້ອງເປັນສະມາຊິກ ຫຼື ຫົວໜ້າຂອງພະແນກນີ້',
        );
      }
    }
    return delegateId;
  }

  async create(dto: CreateSupplyRequestDto, requestedBy: string, ip?: string) {
    const departmentAssignment = await this.resolveDepartmentAssignment(
      dto,
      requestedBy,
    );
    const delegateCode = dto.delegateCode?.trim();
    const delegateId = delegateCode
      ? await this.resolveDelegate(
          delegateCode,
          requestedBy,
          departmentAssignment?.departmentId,
        )
      : undefined;
    for (const item of dto.items) {
      if (item.catalogItemId) {
        await this.catalogService.findOne(item.catalogItemId);
      }
    }
    // ຜູກກັບ catalog ຕາມຊື່ໃຫ້ທັນທີ — ກັນໃບຄົງຈະ REQUESTED ແບບຜູກບໍ່ໄດ້ (approve ປະຕິເສດລາຍການບໍ່ຜູກ)
    await this.autoLinkCatalog(dto.items);
    const _id = await this.generateId();
    const saved = await new this.requestModel({
      _id,
      requestedBy,
      items: dto.items,
      ...(departmentAssignment ?? {}),
      ...(delegateId
        ? {
            delegateId,
            delegateSetBy: requestedBy,
            delegateSetAt: new Date(),
          }
        : {}),
    }).save();
    await this.auditLogsService.log(
      requestedBy,
      'SUPPLY_REQUEST_CREATED',
      'SupplyRequest',
      _id,
      undefined,
      saved.toObject(),
      ip,
    );
    return saved;
  }

  async findRequestableDepartments(userId: string) {
    const user = await this.usersService.findOneRaw(userId);
    return this.departmentsService.findRequestableForUser(
      userId,
      user.departmentId ? String(user.departmentId) : undefined,
    );
  }

  async findMine(userId: string) {
    // Keep the existing personal scope, but include department requests for
    // users explicitly listed as managers. This matches getReceipt()'s
    // department-manager authorization and avoids exposing requests to every
    // employee in the same department.
    const managedDepartmentIds =
      await this.departmentsService.findManagedDepartmentIds(userId);
    const scope: any[] = [
      { requestedBy: userId },
      { custodianId: userId },
      { delegateId: userId },
    ];
    if (managedDepartmentIds.length > 0) {
      scope.push({ departmentId: { $in: managedDepartmentIds } });
    }

    return this.requestModel
      .find({ $or: scope })
      .sort({ createdAt: -1 })
      .populate('requestedBy', 'firstName lastName email employeeCode')
      .populate('departmentId', 'name')
      .populate('custodianId', 'firstName lastName employeeCode')
      .populate('delegateId', 'firstName lastName employeeCode')
      .populate('approvedBy', 'firstName lastName employeeCode')
      .populate('fulfilledBy', 'firstName lastName employeeCode')
      .populate('receivedBy', 'firstName lastName employeeCode')
      .populate('receiveOverride.by', 'firstName lastName employeeCode')
      .exec();
  }

  /**
   * ລາຍການທີ່ບໍ່ຜູກ catalog → ພະຍາຍາມຜູກຕາມຊື່ (case-insensitive) ໃຫ້ທັນທີ.
   * ຖ້າບໍ່ພົບລາຍການໃນ catalog ຈຶ່ງຄົງໄວ້ເດີມ (approve ຈະແຈ້ງ error ໃຫ້ຜູ້ດູແລສາງແກ້ກ່ອນອະນຸມັດ).
   */
  private async autoLinkCatalog(
    items: Array<{ name: string; catalogItemId?: string }>,
  ) {
    for (const item of items) {
      if (item.catalogItemId) continue;
      const matched = await this.catalogService.findByName(item.name);
      if (matched) item.catalogItemId = String(matched._id);
    }
  }

  /**
   * `supplies.read` alone only covers a requester's own rows. Callers that
   * can approve/fulfill/manage the catalog see every request.
   */
  findAll(status?: SupplyRequestStatus, requestedBy?: string) {
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (requestedBy) filter.requestedBy = requestedBy;
    return this.requestModel
      .find(filter)
      .sort({ createdAt: -1 })
      .populate('requestedBy', 'firstName lastName email employeeCode')
      .populate('departmentId', 'name')
      .populate('custodianId', 'firstName lastName employeeCode')
      .populate('delegateId', 'firstName lastName employeeCode')
      .exec();
  }

  async findOne(id: string, requestedBy?: string) {
    const request = await this.requestModel.findById(id).exec();
    if (!request) throw new NotFoundException('Supply request not found');
    if (requestedBy && request.requestedBy.toString() !== requestedBy) {
      throw new NotFoundException('Supply request not found');
    }
    return request;
  }

  private assertStatus(
    request: SupplyRequestDocument,
    expected: SupplyRequestStatus,
  ) {
    if (request.status !== expected) {
      throw new BadRequestException(
        `Request is "${request.status}", expected "${expected}" for this action`,
      );
    }
  }

  /** ກວດສະຖານະວ່າຢູ່ໃນກຸມຂອງທີ່ອະນຸມັດໃຫ້ດຳເນີນການໄດ້ */
  private assertStatusIn(
    request: SupplyRequestDocument,
    allowed: SupplyRequestStatus[],
  ) {
    if (!allowed.includes(request.status)) {
      throw new BadRequestException(
        `Request is "${request.status}", expected one of "${allowed.join(', ')}" for this action`,
      );
    }
  }

  /** ບັນທຶກການຖືກບລັອກຍ້ອນແຍກໜ້າທີ່ — ທຸກຄັ້ງທີ່ຖືກບລັອກ */
  private async logSodBlocked(
    actorId: string,
    entityId: string,
    action: string,
    ip?: string,
  ) {
    await this.auditLogsService.log(
      actorId,
      `SOD_BLOCKED:${action}`,
      'SupplyRequest',
      entityId,
      undefined,
      { blocked: true, action },
      ip,
    );
  }

  async approve(id: string, approverId: string, ip?: string) {
    const request = await this.findOne(id);
    this.assertStatus(request, SupplyRequestStatus.REQUESTED);
    // ແຍກໜ້າທີ່: ຜູ້ຂໍອະນຸມັດໃບຂອງຕົນເອງບໍ່ໄດ້
    if (
      (await sodEnforced()) &&
      request.requestedBy.toString() === approverId
    ) {
      await this.auditLogsService.log(
        approverId,
        'SOD_BLOCKED:SR_APPROVE_SELF',
        'SupplyRequest',
        id,
        undefined,
        { blocked: true, action: 'SR_APPROVE_SELF' },
        ip,
      );
      throw new ForbiddenException(
        'Segregation of duties: you cannot approve your own request',
      );
    }
    // ລາຍການທີ່ບໍ່ໄດ້ຜູກກັບ Catalog ກວດ/ຕັດສະຕ໊ອກບໍ່ໄດ້ → ຕ້ອງຜູກກ່ອນອະນຸມັດ
    // (ລອງຜູກຕາມຊື່ກ່ອນ — ຖ້າບໍ່ພົບຈຶ່ງແຈ້ງໃຫ້ຜູ້ດູແລສາງສ້າງລາຍການໃນ Catalog ກ່ອນ)
    await this.autoLinkCatalog(request.items);
    const unlinked = request.items.filter((i) => !i.catalogItemId);
    if (unlinked.length > 0) {
      throw new BadRequestException(
        `ອະນຸມັດບໍ່ໄດ້: ລາຍການຍັງບໍ່ຜູກກັບ Catalog (${unlinked.map((i) => i.name).join(', ')})`,
      );
    }
    const before = request.toObject();

    request.status = SupplyRequestStatus.APPROVED;
    request.approvedBy = approverId as any;
    request.approvedAt = new Date();
    const saved = await request.save();

    await this.auditLogsService.log(
      approverId,
      'SUPPLY_REQUEST_APPROVED',
      'SupplyRequest',
      id,
      before,
      saved.toObject(),
      ip,
    );

    return saved;
  }

  async reject(id: string, approverId: string, reason: string, ip?: string) {
    const request = await this.findOne(id);
    this.assertStatus(request, SupplyRequestStatus.REQUESTED);
    const before = request.toObject();

    request.status = SupplyRequestStatus.REJECTED;
    request.approvedBy = approverId as any;
    request.approvedAt = new Date();
    request.rejectionReason = reason;
    const saved = await request.save();

    await this.auditLogsService.log(
      approverId,
      'SUPPLY_REQUEST_REJECTED',
      'SupplyRequest',
      id,
      before,
      saved.toObject(),
      ip,
    );

    return saved;
  }

  async fulfill(id: string, fulfilledById: string, ip?: string) {
    const request = await this.findOne(id);
    this.assertStatusIn(request, OPEN_STATUSES);
    const before = request.toObject();

    // ລາຍການທີ່ມີ Asset Tag ຕ້ອງຮັບຜ່ານການສະແກນ (receive) ເພື່ອໃຫ້ທະບຽນຊັບສິນມີຜູ້ຮັບຜິດຊອບ — fulfill ປິດໃບແບບບໍ່ມີຄົນຮັບບໍ່ໄດ້
    const taggedFlags = await Promise.all(
      request.items.map((i) =>
        this.assetsService.requiresAssetTagForCatalog(i.catalogItemId),
      ),
    );
    if (taggedFlags.some(Boolean)) {
      throw new BadRequestException(
        'This request contains items tracked by Asset Tag — use the scan receive flow (PATCH /supply-requests/:id/receive) instead of fulfill',
      );
    }

    const catalogLinkedItems = request.items.filter(
      (item) => item.catalogItemId,
    );
    const catalogItems = await Promise.all(
      catalogLinkedItems.map((item) =>
        this.catalogService.findOne(item.catalogItemId!.toString()),
      ),
    );

    for (const item of catalogLinkedItems) {
      const catalogItem = catalogItems.find(
        (c) => c._id === item.catalogItemId,
      );
      if (!catalogItem || catalogItem.stockQty < item.quantity) {
        throw new BadRequestException(
          `Insufficient stock for "${item.name}": have ${catalogItem?.stockQty ?? 0}, requested ${item.quantity}`,
        );
      }
    }

    for (const item of catalogLinkedItems) {
      await this.catalogService.adjustStock(
        item.catalogItemId!.toString(),
        -item.quantity,
      );
    }

    request.status = SupplyRequestStatus.CLOSED;
    request.fulfilledBy = fulfilledById as any;
    request.fulfilledAt = new Date();
    const saved = await request.save();

    await this.auditLogsService.log(
      fulfilledById,
      'SUPPLY_REQUEST_FULFILLED',
      'SupplyRequest',
      id,
      before,
      saved.toObject(),
      ip,
    );

    return saved;
  }

  /** ຜູ້ຂໍ, ຜູ້ຮັບຜິດຊອບ ຫຼື ຫົວໜ້າແຜນກ (ໃບຂອງແຜນກ) ເທົ່ານັ້ນທີ່ກຳນົດຜູ້ຮັບແທນໄດ້ */
  private async assertCanNameDelegate(
    request: SupplyRequestDocument,
    actorId: string,
  ) {
    const requestDepartmentId = request.departmentId
      ? String(request.departmentId)
      : undefined;
    const isRequester = actorId === request.requestedBy.toString();
    const isCustodian =
      !!request.custodianId && String(request.custodianId) === actorId;
    const isDepartmentManager =
      !!requestDepartmentId &&
      (
        await this.departmentsService.findManagedDepartmentIds(actorId)
      ).includes(requestDepartmentId);
    if (!isRequester && !isCustodian && !isDepartmentManager) {
      throw new ForbiddenException(
        'Only the requester (or the department custodian/manager) can name the person who collects this request',
      );
    }
  }

  /**
   * ລາຍຊື່ຄົນທີ່ເລືອກເປັນຜູ້ຮັບແທນໄດ້ (ຄົ້ນຫາ + ກັ່ນຕອງຕາມແຜນກ) — ຂໍ້ມູນຂັ້ນຕ່ຳເທົ່ານັ້ນ.
   * ໃບຂອງແຜນກ: ຈຳກັດສະເພາະສະມາຊິກ/ຫົວໜ້າຂອງແຜນກນັ້ນ (ກົດດຽວກັບ resolveDelegate).
   */
  async findDelegateCandidates(
    id: string,
    query: { q?: string; departmentId?: string },
    user: PermissionUser,
  ) {
    const actorId = user.userId;
    if (!actorId) throw new BadRequestException('Not authenticated');
    const request = await this.requestModel.findById(id).exec();
    if (!request) throw new NotFoundException('Supply request not found');
    this.assertStatusIn(request, OPEN_STATUSES);
    await this.assertCanNameDelegate(request, actorId);

    const requestDepartmentId = request.departmentId
      ? String(request.departmentId)
      : undefined;
    let managerIds: string[] = [];
    let departments: Array<{ _id: string; name: string }>;
    if (requestDepartmentId) {
      const department =
        await this.departmentsService.findOne(requestDepartmentId);
      managerIds = (department?.managerIds ?? []).map(String);
      departments = [
        { _id: requestDepartmentId, name: department?.name ?? requestDepartmentId },
      ];
    } else {
      const all = await this.departmentsService.findAll();
      departments = all
        .filter((d) => d.isActive !== false)
        .map((d) => ({ _id: String(d._id), name: d.name }));
    }

    const users = await this.usersService.searchForPicker({
      q: query.q,
      departmentId: query.departmentId || undefined,
      restrictToDepartmentId: requestDepartmentId,
      alsoUserIds: managerIds,
      excludeUserIds: [request.requestedBy.toString()],
    });
    return { users, departments };
  }

  /**
   * ກຳນົດ/ປ່ຽນ/ລຶບ ຜູ້ຮັບແທນ (delegate, 1 ຄົນ) ຫຼັງອະນຸມັດ ຈົນກວ່າຈະຮັບເຄື່ອງ.
   * ເຮັດໄດ້ສະເພາະຜູ້ຂໍ, ຜູ້ຮັບຜິດຊອບ ຫຼື ຫົວໜ້າຂອງແຜນກ (ໃບຂອງແຜນກ).
   */
  async setDelegate(
    id: string,
    dto: SetSupplyRequestDelegateDto,
    user: PermissionUser,
    ip?: string,
  ) {
    const actorId = user.userId;
    if (!actorId) throw new BadRequestException('Not authenticated');
    const request = await this.requestModel.findById(id).exec();
    if (!request) throw new NotFoundException('Supply request not found');
    this.assertStatusIn(request, OPEN_STATUSES);

    const requesterId = request.requestedBy.toString();
    const requestDepartmentId = request.departmentId
      ? String(request.departmentId)
      : undefined;
    await this.assertCanNameDelegate(request, actorId);

    const code = dto.delegateCode?.trim();
    const newDelegateId = code
      ? await this.resolveDelegate(code, requesterId, requestDepartmentId)
      : undefined;
    const previousDelegateId = request.delegateId
      ? String(request.delegateId)
      : undefined;
    if (newDelegateId === previousDelegateId) return request;

    const before = request.toObject();
    if (newDelegateId) {
      request.delegateId = newDelegateId as any;
      request.delegateSetBy = actorId as any;
      request.delegateSetAt = new Date();
    } else {
      request.delegateId = undefined;
      request.delegateSetBy = undefined;
      request.delegateSetAt = undefined;
    }
    const saved = await request.save();

    await this.auditLogsService.log(
      actorId,
      newDelegateId
        ? 'SUPPLY_REQUEST_DELEGATE_SET'
        : 'SUPPLY_REQUEST_DELEGATE_CLEARED',
      'SupplyRequest',
      id,
      before,
      saved.toObject(),
      ip,
    );

    if (newDelegateId) {
      try {
        await this.notificationsService.notify(
          newDelegateId,
          'SUPPLY_REQUEST_DELEGATE_SET',
          id,
          'SupplyRequest',
          `ທ່ານຖືກກຳນົດໃຫ້ຮັບເຄື່ອງແທນ: ${id}`,
          `ທ່ານຖືກກຳນົດເປັນຜູ້ຮັບເຄື່ອງແທນຕາມໃບຂໍ ${id} — ເປີດໃບຮັບເຄື່ອງເພື່ອຢືນຢັນເມື່ອມາຮັບ`,
        );
      } catch {
        // the delegate is saved; a failed notification must not undo it
      }
    }
    return saved;
  }

  /**
   * ໃບຮັບເຄື່ອງ (ເປີດຈາກ QR ຂອງໃບຂໍ) — ຜູ້ຂໍ, ຜູ້ຮັບຜິດຊອບ/ຫົວໜ້າແຜນກ,
   * ຫຼື ຜູ້ມີສິດ supplies.* ເທົ່ານັ້ນ
   */
  async getReceipt(id: string, user: PermissionUser) {
    const request = await this.requestModel
      .findById(id)
      .populate('requestedBy', 'firstName lastName employeeCode branchId')
      .populate('departmentId', 'name managerIds branchId')
      .populate('custodianId', 'firstName lastName employeeCode branchId')
      .populate('delegateId', 'firstName lastName employeeCode')
      .exec();
    if (!request) throw new NotFoundException('Supply request not found');

    const ref: any = request.requestedBy;
    const requesterId = String(ref?._id ?? ref);
    const deptRef: any = request.departmentId;
    const departmentId = deptRef ? String(deptRef._id ?? deptRef) : undefined;
    const custodianRef: any = request.custodianId;
    const custodianId = custodianRef
      ? String(custodianRef._id ?? custodianRef)
      : undefined;
    const delegateRef: any = request.delegateId;
    const delegateId = delegateRef
      ? String(delegateRef._id ?? delegateRef)
      : undefined;
    const managerIds: string[] =
      departmentId && typeof deptRef === 'object'
        ? (deptRef.managerIds ?? []).map(String)
        : [];
    const isRequester = requesterId === user.userId;
    const isCustodian = !!custodianId && custodianId === user.userId;
    const isDelegate = !!delegateId && delegateId === user.userId;
    const isDepartmentManager =
      !!departmentId && !!user.userId && managerIds.includes(user.userId);
    const elevated = hasAnyPermission(user, 'supplies', [
      'approve',
      'fulfill',
      'manage',
    ]);
    if (
      !elevated &&
      !isRequester &&
      !isCustodian &&
      !isDelegate &&
      !isDepartmentManager
    ) {
      throw new NotFoundException('Supply request not found');
    }
    const isOpen = OPEN_STATUSES.includes(request.status);
    const isAuthorizedCollector =
      isRequester || isDelegate || isCustodian || isDepartmentManager;
    // ເຈົ້າໜ້າທີ່ສາງທີ່ບໍ່ແມ່ນຜູ້ຂໍ/ຜູ້ຮັບແທນ ຕ້ອງໃຊ້ override (supplies.fulfill + assets.assign + ເຫດຜົນ)
    const canOverride =
      hasPermission(user, 'supplies', 'fulfill') &&
      hasPermission(user, 'assets', 'assign');

    const flags = await Promise.all(
      request.items.map((i) =>
        this.assetsService.requiresAssetTagForCatalog(i.catalogItemId),
      ),
    );
    const obj: any = request.toObject();
    return {
      ...obj,
      items: obj.items.map((it: any, k: number) => ({
        ...it,
        requiresAssetTag: flags[k],
      })),
      isDepartmentRequest: !!departmentId,
      isRequester,
      isCustodian,
      isDelegate,
      isDepartmentManager,
      canConfirm: isOpen && (isAuthorizedCollector || canOverride),
      /** true = ການຢືນຢັນຂອງຜູ້ເປີດຈະເປັນ override — ຕ້ອງໃສ່ເຫດຜົນ */
      requiresOverride: isOpen && !isAuthorizedCollector && canOverride,
      canSetDelegate:
        isOpen && (isRequester || isCustodian || isDepartmentManager),
    };
  }

  /**
   * ຢືນຢັນຮັບເຄື່ອງທັງໃບໃນຄັ້ງດຽວ — ທຸກຢ່າງຢູ່ໃນ transaction ດຽວ (ສຳເລັດທັງໝົດ ຫຼືບໍ່ມີຫຍັງປ່ຽນ):
   * - ຜູ້ເຮັດ: ຜູ້ຂໍ, ຜູ້ຮັບແທນ (delegate) ທີ່ຖືກກຳນົດ, ຜູ້ຮັບຜິດຊອບ/ຫົວໜ້າແຜນກ (ໃບແຜນກ)
   *   ຫຼື ເຈົ້າໜ້າທີ່ສາງ (supplies.fulfill) ຜ່ານ override: ຕ້ອງມີ assets.assign + overrideReason,
   *   ບັນທຶກໃນ audit log + ໃບຂໍ ແລະແຈ້ງເຕືອນຜູ້ຂໍ
   * - ຂອງມີ Asset Tag (catalog ທີ່ມີຊັບສິນຜູກຢູ່): ຕ້ອງສະແກນຄົບຕາມຈຳນວນທີ່ຂໍ (ນັບລວມທີ່ເຄີຍຮັບແລ້ວຜ່ານການສະແກນ)
   * - ສະຕ໊ອກ Catalog ຂອງຂອງມີ Asset Tag ຂະຫຍັບອັດຕະໂນມັດຕາມຊັບສິນ (ເບິ່ງ AssetsService.syncStock)
   * - ຂອງໃຊ້ສິ້ນເປືອງ: ຕ້ອງ confirmConsumables = true ແລະລະບົບຕັດສະຕ໊ອກ
   * - ແຍກໜ້າທີ່ (ເມື່ອເປີດ): ຜູ້ອະນຸມັດເບີກຈ່າຍໃຫ້ໃບຂອງຕົນເອງບໍ່ໄດ້
   */
  async receive(
    id: string,
    dto: ReceiveSupplyRequestDto,
    user: PermissionUser,
    ip?: string,
  ) {
    const audits: AuditEvent[] = [];
    const saved = await runInTransaction(this.connection, async (session) => {
      audits.length = 0;
      const ctx: TxCtx = { session, audits };

      const request = await this.requestModel
        .findById(id)
        .session(session ?? null)
        .exec();
      if (!request) throw new NotFoundException('Supply request not found');
      this.assertStatusIn(request, OPEN_STATUSES);
      const actorId = user.userId;
      if (!actorId) {
        throw new BadRequestException('Not authenticated');
      }

      const requesterId = request.requestedBy.toString();
      const isRequester = actorId === requesterId;
      const canFulfill = hasPermission(user, 'supplies', 'fulfill');
      const canAssign = hasPermission(user, 'assets', 'assign');

      const requestDepartmentId = request.departmentId
        ? String(request.departmentId)
        : undefined;
      let departmentCustodianId: string | undefined;
      let requestDepartmentBranchId: string | undefined;
      let departmentManagerIds: string[] = [];
      if (requestDepartmentId) {
        const department =
          await this.departmentsService.findOne(requestDepartmentId);
        if (!department || department.isActive === false) {
          throw new BadRequestException('ພະແນກບໍ່ພົບ ຫຼື ຖືກປິດໃຊ້ງານ');
        }
        departmentManagerIds = (department.managerIds ?? []).map(String);
        requestDepartmentBranchId = String(department.branchId ?? '').trim();
        if (!requestDepartmentBranchId) {
          throw new BadRequestException('ພະແນກນີ້ບໍ່ໄດ້ກຳນົດສາຂາ');
        }
        if (!request.custodianId) {
          throw new BadRequestException(
            'ໃບຂໍຂອງພະແນກນີ້ບໍ່ມີຜູ້ຮັບຜິດຊອບ — ກະລຸນາແຈ້ງຜູ້ດູແລລະບົບ',
          );
        }
        const custodian = await this.usersService.findOneRaw(
          String(request.custodianId),
        );
        if (custodian.isActive === false) {
          throw new BadRequestException('ບັນຊີຜູ້ຮັບຜິດຊອບຖືກປິດໃຊ້ງານແລ້ວ');
        }
        const custodianInDept =
          String(custodian.departmentId ?? '') === requestDepartmentId;
        if (
          !custodianInDept &&
          !departmentManagerIds.includes(String(custodian._id))
        ) {
          throw new BadRequestException(
            'ຜູ້ຮັບຜິດຊອບບໍ່ໄດ້ເປັນສະມາຊິກ ຫຼື ຫົວໜ້າຂອງພະແນກນີ້',
          );
        }
        departmentCustodianId = String(custodian._id);
      }
      const isDepartmentRequest = !!requestDepartmentId;
      const isCustodian =
        !!departmentCustodianId && actorId === departmentCustodianId;
      const isDepartmentManager =
        isDepartmentRequest && departmentManagerIds.includes(actorId);
      const isDelegate =
        !!request.delegateId && String(request.delegateId) === actorId;
      const isAuthorizedCollector =
        isRequester || isDelegate || isCustodian || isDepartmentManager;
      let overrideReason: string | undefined;
      if (!isAuthorizedCollector) {
        if (!canFulfill) {
          throw new ForbiddenException(
            'Only the requester, the named delegate, the department custodian/manager (or warehouse staff using the override) can confirm receipt of this request',
          );
        }
        // ເຈົ້າໜ້າທີ່ສາງຮັບແທນ = override: ຕ້ອງມີສິດ assets.assign + ເຫດຜົນເປັນລາຍລັກອັກສອນ
        if (!canAssign) {
          throw new ForbiddenException(
            'Collecting on behalf of the requester (override) requires the "assets.assign" permission',
          );
        }
        overrideReason = dto.overrideReason?.trim();
        if (!overrideReason || overrideReason.length < 5) {
          throw new BadRequestException(
            'A written reason (overrideReason, at least 5 characters) is required when confirming receipt on behalf of the requester',
          );
        }
      }
      if (
        (await sodEnforced()) &&
        !isRequester &&
        request.approvedBy &&
        String(request.approvedBy) === actorId
      ) {
        await this.logSodBlocked(actorId, id, 'SR_RECEIVE_AFTER_APPROVE', ip);
        throw new ForbiddenException(
          'Segregation of duties: the approver of this request cannot also issue the equipment',
        );
      }

      // 1. ຜູ້ຮັບເຄື່ອງ — ໃບສ່ວນຕົວ default ແມ່ນຜູ້ຂໍ,
      //    ໃບຂອງພະແນກ default ແມ່ນຜູ້ຮັບຜິດຊອບ (custodian) ຂອງພະແນກ
      let assigneeId = isDepartmentRequest
        ? departmentCustodianId!
        : requesterId;
      let receivedById: string | undefined;
      if (dto.assigneeCode?.trim()) {
        const assignee = await this.usersService.findByEmployeeCode(
          dto.assigneeCode.trim(),
        );
        if (!assignee) {
          throw new BadRequestException(
            `Employee code "${dto.assigneeCode}" not found`,
          );
        }
        if (assignee.isActive === false) {
          throw new BadRequestException(
            `Employee code "${dto.assigneeCode}" is inactive`,
          );
        }
        if (isDepartmentRequest) {
          const receiverInDept =
            String(assignee.departmentId ?? '') === requestDepartmentId;
          const receiverIsManager = departmentManagerIds.includes(
            String(assignee._id),
          );
          if (!receiverInDept && !receiverIsManager) {
            throw new BadRequestException(
              'ຜູ້ຮັບແທນຕ້ອງເປັນສະມາຊິກ ຫຼື ຫົວໜ້າຂອງພະແນກນີ້',
            );
          }
          if (String(assignee._id) !== departmentCustodianId) {
            receivedById = String(assignee._id);
          }
        } else {
          assigneeId = assignee._id.toString();
        }
      }
      if (
        isDepartmentRequest &&
        !receivedById &&
        actorId !== departmentCustodianId &&
        (isRequester || isDepartmentManager || isDelegate)
      ) {
        receivedById = actorId;
      }
      const proxyReceiver = isDepartmentRequest && !!receivedById;
      const allowedAssignee = isDepartmentRequest
        ? proxyReceiver
          ? isRequester ||
            isDelegate ||
            isCustodian ||
            isDepartmentManager ||
            canAssign
          : isRequester ||
            isDelegate ||
            isCustodian ||
            isDepartmentManager ||
            canFulfill ||
            canAssign
        : (isRequester && assigneeId === actorId) ||
          (isDelegate && assigneeId === requesterId) ||
          canAssign ||
          (canFulfill && assigneeId === requesterId);
      if (!allowedAssignee) {
        throw new ForbiddenException(
          'Giving the equipment to another employee requires the "assets.assign" permission',
        );
      }

      // 2. ຈຳແນກລາຍການຈາກ Supply Catalog ກ່ອນກວດ Asset Tag.
      //    ສະເພາະ ASSET (ແລະ legacy item ທີ່ຍັງບໍ່ມີ itemType) ເທົ່ານັ້ນທີ່ຮັບດ້ວຍ Asset Tag.
      const items = request.items;
      const catalogTagged = await Promise.all(
        items.map((i) =>
          this.assetsService.requiresAssetTagForCatalog(i.catalogItemId, session),
        ),
      );
      const assetItemIndexes = items
        .map((_, index) => (catalogTagged[index] ? index : -1))
        .filter((index) => index >= 0);
      const assetRequestItems = assetItemIndexes.map((index) => items[index]);

      const tags = [
        ...new Set((dto.assetTags ?? []).map((t) => t.trim()).filter(Boolean)),
      ];
      const issues: string[] = [];
      const resolved: AssetDocument[] = [];
      const seenAssetIds = new Set<string>();
      for (const tag of tags) {
        const asset = await this.assetsService.findByTagOrId(tag, session);
        if (!asset) {
          issues.push(`"${tag}": ບໍ່ພົບໃນທະບຽນຊັບສິນ`);
          continue;
        }
        // tag ກັບ _id ຂອງຊັບສິນດຽວກັນ (ສະແກນທັງ QR ແລະບາໂຄ໊ດ) ນັບເປັນຊິ້ນດຽວ
        if (seenAssetIds.has(String(asset._id))) continue;
        seenAssetIds.add(String(asset._id));
        if (asset.status !== AssetStatus.AVAILABLE) {
          issues.push(`"${tag}": ສະຖານະ ${asset.status} — ບໍ່ວ່າງ`);
          continue;
        }
        // ຖ້າ Asset Record ເກົ່າຜູກກັບ Catalog ປະເພດ CONSUMABLE, ຫ້າມຮັບມັນເປັນຊັບສິນ.
        if (
          asset.catalogItemId &&
          !(await this.assetsService.requiresAssetTagForCatalog(
            String(asset.catalogItemId),
            session,
          ))
        ) {
          issues.push(
            `"${tag}": Catalog ທີ່ຜູກຢູ່ເປັນ CONSUMABLE ຫຼືບໍ່ແມ່ນລາຍການຊັບສິນ — ກະລຸນາກວດສອບທະບຽນ`,
          );
          continue;
        }
        resolved.push(asset);
      }

      // 3. ຈັບຄູ່ກັບສະເພາະລາຍການ ASSET. ຂອງສິ້ນເປືອງຈະບໍ່ຖືກນັບເປັນຊັບສິນເຖິງແມ່ນຊື່ຄ້າຍກັນ.
      const prior = await this.assetsService.findManyByIds(
        request.receivedAssetIds ?? [],
        session,
      );
      const matched: number[] = items.map(() => 0);
      const matchTrackedAsset = (asset: AssetDocument, counts: number[]) => {
        const trackedCounts = assetItemIndexes.map((index) => counts[index]);
        const trackedIndex = matchAssetToItem(assetRequestItems, asset, trackedCounts);
        return trackedIndex >= 0 ? assetItemIndexes[trackedIndex] : -1;
      };
      for (const priorAsset of prior) {
        if (
          priorAsset.catalogItemId &&
          !(await this.assetsService.requiresAssetTagForCatalog(
            String(priorAsset.catalogItemId),
            session,
          ))
        ) {
          issues.push(
            `Asset ${priorAsset.assetTag} ທີ່ຮັບໄວ້ກ່ອນໜ້ານີ້ຜູກກັບ Catalog ປະເພດ CONSUMABLE — ຕ້ອງກວດສອບຂໍ້ມູນ`,
          );
          continue;
        }
        const index = matchTrackedAsset(priorAsset, matched);
        if (index >= 0) matched[index] += 1;
      }
      for (const asset of resolved) {
        const idx = matchTrackedAsset(asset, matched);
        if (idx === -1) {
          issues.push(
            `"${asset.assetTag}": ຊະນິດ "${asset.type}" ບໍ່ກົງກັບລາຍການ ASSET ທີ່ຂໍ`,
          );
          continue;
        }
        matched[idx] += 1;
        if (matched[idx] > items[idx].quantity) {
          issues.push(
            `"${asset.assetTag}": ເກີນຈຳນວນທີ່ຂໍສຳລັບ "${items[idx].name}" (ຂໍ ${items[idx].quantity}, ສະແກນຮອດ ${matched[idx]})`,
          );
        }
      }

      // 4. ຂອງມີ Asset Tag ຕ້ອງຄົບ; ຂອງໃຊ້ສິ້ນເປືອງຕ້ອງຢືນຢັນ + ສະຕ໊ອກພໍ
      const consumableIdx: number[] = [];
      items.forEach((it, k) => {
        if (catalogTagged[k]) {
          if (matched[k] !== it.quantity) {
            issues.push(
              `"${it.name}": ຕ້ອງສະແກນ ${it.quantity} ຊິ້ນ (ສະແກນຖືກຕ້ອງແລ້ວ ${matched[k]})`,
            );
          }
        } else if (matched[k] === 0) {
          consumableIdx.push(k);
        }
      });
      if (consumableIdx.length > 0 && !dto.confirmConsumables) {
        issues.push(
          `ກະລຸນາຢືນຢັນວ່າໄດ້ຮັບຂອງໃຊ້ສິ້ນເປືອງຄົບ: ${consumableIdx.map((k) => items[k].name).join(', ')}`,
        );
      }
      if (consumableIdx.length > 0 && dto.confirmConsumables) {
        for (const k of consumableIdx) {
          const it = items[k];
          if (!it.catalogItemId) continue;
          const cat = await this.catalogService.findOne(
            it.catalogItemId.toString(),
          );
          if (cat.stockQty < it.quantity) {
            issues.push(
              `"${it.name}": ສະຕ໊ອກບໍ່ພໍ (ມີ ${cat.stockQty}, ຂໍ ${it.quantity})`,
            );
          }
        }
      }
      if (issues.length > 0) {
        throw new BadRequestException(issues.join('; '));
      }

      // 5. ບັນທຶກທັງໝົດໃນ transaction: ມອບຊັບສິນ (ສະຕ໊ອກຂອງມີ Asset Tag ຂະຫຍັບໃຫ້ເອງ) + ຕັດສະຕ໊ອກຂອງສິ້ນເປືອງ + ປິດໃບຂໍ
      const before = request.toObject();
      for (const asset of resolved) {
        await this.assetsService.assignInCtx(
          asset,
          assigneeId,
          `ມາຈາກຄຳຂໍ ${id} (ຮັບເຄື່ອງດ້ວຍການສະແກນ QR)`,
          actorId,
          ip,
          ctx,
          isDepartmentRequest
            ? {
                departmentId: requestDepartmentId,
                branchId: requestDepartmentBranchId!,
                receivedById,
              }
            : undefined,
        );
      }
      for (const k of consumableIdx) {
        const it = items[k];
        if (it.catalogItemId) {
          await this.catalogService.adjustStock(
            it.catalogItemId.toString(),
            -it.quantity,
            session,
          );
        }
      }

      request.receivedAssetIds = [
        ...(request.receivedAssetIds ?? []),
        ...resolved.map((a) => String(a._id)),
      ];
      request.status = SupplyRequestStatus.CLOSED;
      request.fulfilledBy = actorId as any;
      request.fulfilledAt = new Date();
      request.receivedBy = (receivedById ?? assigneeId) as any;
      if (overrideReason) {
        request.receiveOverride = {
          by: actorId as any,
          reason: overrideReason,
          at: new Date(),
        };
      }
      const savedRequest = await request.save({ session });

      audits.push({
        actorId,
        action: 'SUPPLY_REQUEST_RECEIVED',
        entityType: 'SupplyRequest',
        entityId: id,
        before,
        after: savedRequest.toObject(),
        ip,
      });
      if (overrideReason) {
        audits.push({
          actorId,
          action: 'SUPPLY_REQUEST_RECEIVE_OVERRIDE',
          entityType: 'SupplyRequest',
          entityId: id,
          after: {
            reason: overrideReason,
            requesterId,
            delegateId: request.delegateId
              ? String(request.delegateId)
              : undefined,
          },
          ip,
        });
      }
      return savedRequest;
    });

    // audit ບັນທຶກຫຼັງ commit ສຳເລັດເທົ່ານັ້ນ
    await this.assetsService.flushAudits(audits);
    if (saved.receiveOverride && String(saved.receiveOverride.by) === user.userId) {
      await this.notifyReceiveOverride(saved, user.userId!);
    }
    return saved;
  }

  /** ແຈ້ງເຕືອນຜູ້ຂໍ (ແລະຜູ້ຮັບແທນທີ່ຖືກຂ້າມ) ວ່າມີຄົນອື່ນຮັບເຄື່ອງແທນ — ລົ້ມເຫລວກໍ່ບໍ່ກະທົບການຮັບເຄື່ອງ */
  private async notifyReceiveOverride(
    request: SupplyRequestDocument,
    actorId: string,
  ) {
    try {
      const actor = await this.usersService.findOneRaw(actorId);
      const actorName =
        `${actor.firstName ?? ''} ${actor.lastName ?? ''}`.trim() ||
        actor.employeeCode ||
        actorId;
      const reason = request.receiveOverride?.reason ?? '';
      const recipients = new Set<string>([String(request.requestedBy)]);
      if (request.delegateId) recipients.add(String(request.delegateId));
      recipients.delete(actorId);
      for (const userId of recipients) {
        await this.notificationsService.notify(
          userId,
          'SUPPLY_REQUEST_RECEIVE_OVERRIDE',
          String(request._id),
          'SupplyRequest',
          `ມີຄົນຮັບເຄື່ອງແທນ: ${request._id}`,
          `${actorName} (ເຈົ້າໜ້າທີ່ສາງ) ໄດ້ຢືນຢັນຮັບເຄື່ອງຕາມໃບຂໍ ${request._id} ແທນ — ເຫດຜົນ: ${reason}`,
        );
      }
    } catch {
      // the receipt is already committed; a failed notification must not fail it
    }
  }

  async bulkFulfill(ids: string[], fulfilledById: string, ip?: string) {
    const results: { id: string; success: boolean; error?: string }[] = [];
    for (const id of ids) {
      try {
        await this.fulfill(id, fulfilledById, ip);
        results.push({ id, success: true });
      } catch (err: any) {
        results.push({
          id,
          success: false,
          error: err?.message ?? 'Unknown error',
        });
      }
    }
    return results;
  }
}
