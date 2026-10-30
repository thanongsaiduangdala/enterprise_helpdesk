import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model } from 'mongoose';
import {
  SupplyRequest,
  SupplyRequestDocument,
  SupplyRequestSource,
  SupplyRequestStatus,
} from './schemas/supply-request.schema';
import {
  PurchaseRequest,
  PurchaseRequestDocument,
  PurchaseRequestStatus,
} from '../purchase-requests/schemas/purchase-request.schema';
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
  SUPER_ADMIN_ROLE,
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
    @InjectModel(PurchaseRequest.name)
    private purchaseModel: Model<PurchaseRequestDocument>,
  ) {}

  // ───────────── ຜູກກັບໃບສະເໜີຊື້ (ຂອງບໍ່ພໍສະຕັອກ) ─────────────

  /** ລາຍການທີ່ຜູກກັບໃບສະເໜີຊື້ ແລະຂອງຍັງມາບໍ່ຄົບ */
  private hasPendingPurchase(request: {
    items: Array<{
      purchaseRequestId?: string;
      purchaseQty?: number;
      arrivedQty?: number;
    }>;
  }) {
    return request.items.some(
      (i) => !!i.purchaseRequestId && (i.arrivedQty ?? 0) < (i.purchaseQty ?? 0),
    );
  }

  /**
   * ກວດ ແລະ ຕັ້ງຄ່າການຜູກ item -> ໃບສະເໜີຊື້ ຕອນສ້າງຄຳຂໍ.
   * - ໃບສະເໜີຕ້ອງເປັນຂອງຜູ້ຂໍເອງ, ລາຍການ catalog ດຽວກັນ, ຍັງບໍ່ຖືກຜູກກັບຄຳຂໍອື່ນ,
   *   ສະຖານະ PENDING/APPROVED ແລະຍັງບໍ່ຮັບເຄື່ອງ
   * - ຈຳນວນຊື້ ຕ້ອງຄຸມສ່ວນທີ່ສະຕັອກບໍ່ພໍ (quantity - stock) ແລະບໍ່ເກີນຈຳນວນທີ່ຂໍ
   * ຄືນລາຍຊື່ໃບສະເໜີ [prId, itemIndex] ເພື່ອໄປຕັ້ງ supplyRequestId ພາຍຫຼັງ
   */
  private async prepareLinks(
    items: Array<{
      catalogItemId?: string;
      name: string;
      quantity: number;
      purchaseRequestId?: string;
      purchaseRequestNo?: string;
      purchaseQty?: number;
      arrivedQty?: number;
    }>,
    requestedBy: string,
  ): Promise<Array<{ prId: string; itemIndex: number }>> {
    const links: Array<{ prId: string; itemIndex: number }> = [];
    const seen = new Set<string>();
    for (let k = 0; k < items.length; k++) {
      const item = items[k];
      if (!item.purchaseRequestId) continue;
      const prId = String(item.purchaseRequestId);
      if (seen.has(prId)) {
        throw new BadRequestException(
          'ໃບສະເໜີຊື້ໃບດຽວຜູກໄດ້ກັບລາຍການດຽວເທົ່ານັ້ນ',
        );
      }
      seen.add(prId);
      if (!item.catalogItemId) {
        throw new BadRequestException(
          `"${item.name}": ຜູກກັບໃບສະເໜີຊື້ໄດ້ສະເພາະລາຍການທີ່ມີໃນ Catalog`,
        );
      }
      const pr = await this.purchaseModel.findById(prId).exec();
      if (!pr) throw new BadRequestException('ບໍ່ພົບໃບສະເໜີຊື້ທີ່ຜູກ');
      if (String(pr.requestedBy) !== requestedBy) {
        throw new ForbiddenException(
          `ໃບສະເໜີ ${pr.prNo} ບໍ່ແມ່ນຂອງທ່ານ — ຜູກໄດ້ສະເພາະໃບທີ່ຕົນເອງສະເໜີ`,
        );
      }
      if (
        pr.status !== PurchaseRequestStatus.PENDING &&
        pr.status !== PurchaseRequestStatus.APPROVED
      ) {
        throw new BadRequestException(
          `ໃບສະເໜີ ${pr.prNo} ຢູ່ໃນສະຖານະ ${pr.status} — ຜູກກັບຄຳຂໍເບີກບໍ່ໄດ້`,
        );
      }
      if ((pr.receivedQuantity ?? 0) > 0) {
        throw new BadRequestException(
          `ໃບສະເໜີ ${pr.prNo} ມີການຮັບເຄື່ອງແລ້ວ — ຜູກກັບຄຳຂໍເບີກບໍ່ໄດ້`,
        );
      }
      if (pr.supplyRequestId) {
        throw new BadRequestException(
          `ໃບສະເໜີ ${pr.prNo} ຖືກຜູກກັບຄຳຂໍເບີກ ${pr.supplyRequestId} ແລ້ວ`,
        );
      }
      if (!pr.catalogItemId || pr.catalogItemId !== item.catalogItemId) {
        throw new BadRequestException(
          `ໃບສະເໜີ ${pr.prNo} (${pr.itemName}) ບໍ່ກົງກັບລາຍການ "${item.name}"`,
        );
      }
      const catalogItem = await this.catalogService.findOne(item.catalogItemId);
      const shortage = Math.max(item.quantity - (catalogItem.stockQty ?? 0), 0);
      if (pr.quantity > item.quantity) {
        throw new BadRequestException(
          `ໃບສະເໜີ ${pr.prNo} ຂໍຊື້ ${pr.quantity} ເກີນຈຳນວນທີ່ຂໍເບີກ (${item.quantity})`,
        );
      }
      if (pr.quantity < shortage) {
        throw new BadRequestException(
          `ໃບສະເໜີ ${pr.prNo} ຂໍຊື້ ${pr.quantity} ບໍ່ພໍກັບສ່ວນທີ່ສະຕັອກບໍ່ພໍ (ຂາດ ${shortage})`,
        );
      }
      item.purchaseRequestId = prId;
      item.purchaseRequestNo = pr.prNo;
      item.purchaseQty = pr.quantity;
      item.arrivedQty = 0;
      links.push({ prId, itemIndex: k });
    }
    return links;
  }

  /** ເພີ່ມສະຖານະໃບສະເໜີຊື້ (purchaseStatus) ໃສ່ລາຍການທີ່ຜູກ — ສຳລັບສະແດງໃນໜ້າຈໍ */
  private async attachPurchaseStatus<T extends { items?: any[] }>(
    docs: T[],
  ): Promise<any[]> {
    const ids = new Set<string>();
    for (const d of docs) {
      for (const i of d.items ?? []) {
        if (i.purchaseRequestId) ids.add(String(i.purchaseRequestId));
      }
    }
    if (ids.size === 0) return docs as any[];
    const prs = await this.purchaseModel
      .find({ _id: { $in: [...ids] } }, { status: 1, prNo: 1, receivedQuantity: 1 })
      .lean()
      .exec();
    const byId = new Map(prs.map((p: any) => [String(p._id), p]));
    return docs.map((d: any) => {
      const obj = typeof d.toObject === 'function' ? d.toObject() : d;
      return {
        ...obj,
        items: (obj.items ?? []).map((i: any) => {
          if (!i.purchaseRequestId) return i;
          const pr: any = byId.get(String(i.purchaseRequestId));
          return { ...i, purchaseStatus: pr?.status };
        }),
      };
    });
  }

  private async releasePurchaseLinks(prIds: string[]) {
    if (prIds.length === 0) return;
    await this.purchaseModel
      .updateMany(
        { _id: { $in: prIds } },
        { $unset: { supplyRequestId: 1, supplyRequestItemIndex: 1 } },
      )
      .exec();
  }

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
   * ຜູ້ຂໍ ຕ້ອງເປັນຫົວໜ້າພະແນກ (managerIds) ເທົ່ານັ້ນ;
   * ຜູ້ຮັບຜິດຊອບ ຕ້ອງເປັນສະມາຊິກ ຫຼື ຫົວໜ້າຂອງພະແນກນັ້ນ.
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
    if (!managerIds.includes(String(requester._id))) {
      throw new ForbiddenException(
        `ຂໍໃນນາມພະແນກໄດ້ສະເພາະຫົວໜ້າພະແນກ "${department.name}"`,
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

  /**
   * ຄຳຂໍສ່ວນບຸກຄົນ → ຕ້ອງຜ່ານຫົວໜ້າພະແນກຂອງຜູ້ຂໍກ່ອນ (PENDING_MANAGER).
   * ຂ້າມຂັ້ນນີ້ (ເຂົ້າຄິວຝ່າຍສາງເລີຍ) ເມື່ອ: ຜູ້ຂໍບໍ່ມີພະແນກ / ພະແນກບໍ່ມີຫົວໜ້າທີ່ຍັງໃຊ້ງານ /
   * ຜູ້ຂໍເປັນຫົວໜ້າເອງ (ບໍ່ອະນຸມັດຕົນເອງ) / ປິດດ້ວຍ MANAGER_APPROVAL_REQUIRED=false
   */
  private async resolveManagerStage(requesterId: string): Promise<{
    status: SupplyRequestStatus;
    managerDepartmentId?: string;
    managerStageSkipped?: string;
    managerIds: string[];
  }> {
    const skip = (reason: string) => ({
      status: SupplyRequestStatus.REQUESTED,
      managerStageSkipped: reason,
      managerIds: [] as string[],
    });
    if (process.env.MANAGER_APPROVAL_REQUIRED === 'false') return skip('DISABLED');
    const requester = await this.usersService.findOneRaw(requesterId);
    if (!requester.departmentId) return skip('NO_DEPARTMENT');
    const department = await this.departmentsService.findOne(
      String(requester.departmentId),
    );
    const allManagerIds = (department?.managerIds ?? []).map(String);
    if (allManagerIds.includes(requesterId)) return skip('REQUESTER_IS_MANAGER');
    const activeManagerIds: string[] = [];
    for (const managerId of allManagerIds) {
      try {
        const manager = await this.usersService.findOneRaw(managerId);
        if (manager && manager.isActive !== false) activeManagerIds.push(managerId);
      } catch {
        // ຫົວໜ້າທີ່ຖືກລຶບ/ຫາບໍ່ພົບ — ບໍ່ນັບ
      }
    }
    if (activeManagerIds.length === 0) return skip('NO_MANAGER');
    return {
      status: SupplyRequestStatus.PENDING_MANAGER,
      managerDepartmentId: String(department._id),
      managerIds: activeManagerIds,
    };
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
    // ຜູກກັບໃບສະເໜີຊື້ (ສ່ວນທີ່ສະຕັອກບໍ່ພໍ) — ຄ່າ purchaseQty/arrivedQty ຕັ້ງໂດຍ backend ເທົ່ານັ້ນ
    const items = dto.items.map((i) => ({
      catalogItemId: i.catalogItemId,
      name: i.name,
      quantity: i.quantity,
      reason: i.reason,
      purchaseRequestId: i.purchaseRequestId,
    })) as Array<any>;
    const links = await this.prepareLinks(items, requestedBy);
    const managerStage = departmentAssignment
      ? undefined
      : await this.resolveManagerStage(requestedBy);
    const _id = await this.generateId();
    // ຈອງໃບສະເໜີ (ກັນຜູກຊ້ຳ) ກ່ອນບັນທຶກຄຳຂໍ; ຖ້າບັນທຶກບໍ່ສຳເລັດ ຄືນຄ່າຄືນ
    const claimed: string[] = [];
    try {
      for (const l of links) {
        const res = await this.purchaseModel
          .updateOne(
            { _id: l.prId, supplyRequestId: { $exists: false } },
            { $set: { supplyRequestId: _id, supplyRequestItemIndex: l.itemIndex } },
          )
          .exec();
        if (res.modifiedCount !== 1) {
          throw new BadRequestException(
            'ໃບສະເໜີຊື້ຖືກຜູກກັບຄຳຂໍອື່ນແລ້ວ — ກະລຸນາລອງໃໝ່',
          );
        }
        claimed.push(l.prId);
      }
    } catch (err) {
      await this.releasePurchaseLinks(claimed);
      throw err;
    }
    let saved: SupplyRequestDocument;
    try {
      saved = await new this.requestModel({
      _id,
      requestedBy,
      items,
      source: departmentAssignment
        ? SupplyRequestSource.DEPARTMENT
        : SupplyRequestSource.PERSONAL,
      ...(managerStage
        ? {
            status: managerStage.status,
            ...(managerStage.managerDepartmentId
              ? { managerDepartmentId: managerStage.managerDepartmentId }
              : {}),
            ...(managerStage.managerStageSkipped
              ? { managerStageSkipped: managerStage.managerStageSkipped }
              : {}),
          }
        : {}),
      ...(departmentAssignment ?? {}),
      ...(delegateId
        ? {
            delegateId,
            delegateSetBy: requestedBy,
            delegateSetAt: new Date(),
          }
        : {}),
      }).save();
    } catch (err) {
      await this.releasePurchaseLinks(claimed);
      throw err;
    }
    await this.auditLogsService.log(
      requestedBy,
      'SUPPLY_REQUEST_CREATED',
      'SupplyRequest',
      _id,
      undefined,
      saved.toObject(),
      ip,
    );
    if (departmentAssignment) {
      await this.notifyDepartmentRequestCreated(saved, requestedBy);
    } else if (managerStage?.status === SupplyRequestStatus.PENDING_MANAGER) {
      // ແຈ້ງສະເພາະຫົວໜ້າພະແນກ — ຍັງບໍ່ແຈ້ງຝ່າຍສາງ/ຜູ້ອະນຸມັດ
      await this.notifyManagersToReview(saved, requestedBy, managerStage.managerIds);
    } else if (managerStage) {
      // ຂ້າມຂັ້ນຫົວໜ້າ (ບໍ່ມີຫົວໜ້າ ຯລຯ) → ເຂົ້າຄິວຝ່າຍສາງເລີຍ ແຈ້ງຜູ້ອະນຸມັດ
      await this.notifyApproversAwaiting(saved, requestedBy);
    }
    return saved;
  }

  /**
   * ແຈ້ງຫົວໜ້າແຜນກ (managerIds) ແລະ ຜູ້ຮັບຜິດຊອບ (custodian) ເມື່ອມີຄົນສ້າງໃບຂໍໃນນາມແຜນກ
   * ຂ້າມຜູ້ຂໍເອງ — ລົ້ມເຫລວບໍ່ກະທົບການສ້າງໃບຂໍ (ບັນທຶກໄປແລ້ວ)
   */
  private async notifyDepartmentRequestCreated(
    request: SupplyRequestDocument,
    requesterId: string,
  ) {
    try {
      if (!request.departmentId) return;
      const department = await this.departmentsService.findOne(
        String(request.departmentId),
      );
      const requester = await this.usersService.findOneRaw(requesterId);
      const requesterName =
        `${requester.firstName ?? ''} ${requester.lastName ?? ''}`.trim() ||
        requester.employeeCode ||
        requesterId;
      const recipients = new Set<string>(
        (department?.managerIds ?? []).map(String),
      );
      if (request.custodianId) recipients.add(String(request.custodianId));
      recipients.delete(requesterId);
      const id = String(request._id);
      const deptName = department?.name ?? String(request.departmentId);
      for (const userId of recipients) {
        await this.notificationsService.notify(
          userId,
          'SUPPLY_REQUEST_DEPARTMENT_CREATED',
          id,
          'SupplyRequest',
          `ມີຄຳຂໍເບີກໃນນາມແຜນກ ${deptName}: ${id}`,
          `${requesterName} ໄດ້ສ້າງຄຳຂໍເບີກ ${id} ໃນນາມແຜນກ ${deptName} (${request.items.length} ລາຍການ)`,
        );
      }
    } catch {
      // the request is saved; a failed notification must not undo it
    }
  }

  private async requesterDisplayName(userId: string) {
    const user = await this.usersService.findOneRaw(userId);
    return (
      `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() ||
      user.employeeCode ||
      userId
    );
  }

  /** ແຈ້ງຫົວໜ້າພະແນກວ່າມີຄຳຂໍສ່ວນບຸກຄົນລໍຖ້າອະນຸມັດ — ລົ້ມເຫລວບໍ່ກະທົບການສ້າງໃບຂໍ */
  private async notifyManagersToReview(
    request: SupplyRequestDocument,
    requesterId: string,
    managerIds: string[],
  ) {
    try {
      const id = String(request._id);
      const name = await this.requesterDisplayName(requesterId);
      for (const managerId of managerIds) {
        if (managerId === requesterId) continue;
        await this.notificationsService.notify(
          managerId,
          'SUPPLY_REQUEST_MANAGER_REVIEW',
          id,
          'SupplyRequest',
          `ມີຄຳຂໍເບີກລໍຖ້າທ່ານອະນຸມັດ: ${id}`,
          `${name} ຂໍເບີກ ${request.items.length} ລາຍການ (${id}) — ກະລຸນາອະນຸມັດ ຫຼື ປະຕິເສດ`,
        );
      }
    } catch {
      // the request is saved; a failed notification must not undo it
    }
  }

  /** ແຈ້ງຜູ້ມີສິດອະນຸມັດ (supplies:approve) ວ່າມີຄຳຂໍເຂົ້າຄິວຝ່າຍສາງແລ້ວ */
  private async notifyApproversAwaiting(
    request: SupplyRequestDocument,
    requesterId: string,
  ) {
    try {
      const id = String(request._id);
      const name = await this.requesterDisplayName(requesterId);
      const approverIds = await this.usersService.findActiveIdsWithPermission(
        'supplies',
        'approve',
      );
      for (const approverId of approverIds) {
        if (approverId === requesterId) continue;
        await this.notificationsService.notify(
          approverId,
          'SUPPLY_REQUEST_AWAITING_APPROVAL',
          id,
          'SupplyRequest',
          `ມີຄຳຂໍເບີກລໍຖ້າອະນຸມັດ: ${id}`,
          `${name} ຂໍເບີກ ${request.items.length} ລາຍການ (${id})`,
        );
      }
    } catch {
      // the request is saved; a failed notification must not undo it
    }
  }

  /**
   * ຄິວຂັ້ນທີ 1: ໃບສ່ວນບຸກຄົນທີ່ລໍຖ້າຫົວໜ້າພະແນກ.
   * - ຫົວໜ້າພະແນກ: ເຫັນສະເພາະພະແນກທີ່ຕົນເປັນຫົວໜ້າ
   * - ຜູ້ບໍລິຫານສູງສຸດ (SUPER_ADMIN): ເຫັນທຸກໃບ (ອະນຸມັດແທນໄດ້ ເມື່ອຫົວໜ້າລາພັກ)
   * - ຄົນອື່ນ (ລວມ AGENT/ຝ່າຍສາງທີ່ມີ supplies:approve): 403 (frontend ຊ່ອນແຖບ)
   */
  async findManagerQueue(user: PermissionUser) {
    const actorId = user.userId;
    if (!actorId) throw new BadRequestException('Not authenticated');
    const substitute = user.role === SUPER_ADMIN_ROLE;
    const managed = await this.departmentsService.findManagedDepartmentIds(actorId);
    if (!substitute && managed.length === 0) {
      throw new ForbiddenException('ສະເພາະຫົວໜ້າພະແນກເທົ່ານັ້ນ');
    }
    const filter: Record<string, unknown> = {
      status: SupplyRequestStatus.PENDING_MANAGER,
    };
    if (!substitute) filter.managerDepartmentId = { $in: managed };
    const docs = await this.requestModel
      .find(filter)
      .sort({ createdAt: -1 })
      .populate('requestedBy', 'firstName lastName email employeeCode')
      .populate('managerDepartmentId', 'name')
      .populate('delegateId', 'firstName lastName employeeCode')
      .exec();
    return this.attachPurchaseStatus(docs);
  }

  /** ກວດສິດອະນຸມັດຂັ້ນຫົວໜ້າ: ຫົວໜ້າພະແນກຂອງຜູ້ຂໍ ຫຼື SUPER_ADMIN (ແທນ) — AGENT/ຝ່າຍສາງບໍ່ມີສິດຂັ້ນນີ້ */
  private async assertCanReviewAsManager(
    request: SupplyRequestDocument,
    user: PermissionUser,
    action: 'APPROVE' | 'REJECT',
    ip?: string,
  ): Promise<{ substitute: boolean }> {
    const actorId = user.userId;
    if (!actorId) throw new BadRequestException('Not authenticated');
    if (request.status !== SupplyRequestStatus.PENDING_MANAGER) {
      throw new BadRequestException(
        `Request is "${request.status}", expected "PENDING_MANAGER" for this action`,
      );
    }
    if ((await sodEnforced()) && request.requestedBy.toString() === actorId) {
      await this.logSodBlocked(actorId, String(request._id), `SR_MANAGER_${action}_SELF`, ip);
      throw new ForbiddenException(
        'Segregation of duties: you cannot review your own request',
      );
    }
    const managed = await this.departmentsService.findManagedDepartmentIds(actorId);
    const isManager =
      !!request.managerDepartmentId &&
      managed.includes(String(request.managerDepartmentId));
    if (isManager) return { substitute: false };
    if (user.role === SUPER_ADMIN_ROLE) return { substitute: true };
    throw new ForbiddenException(
      'ສະເພາະຫົວໜ້າພະແນກຂອງຜູ້ຂໍ ຫຼື ຜູ້ບໍລິຫານສູງສຸດເທົ່ານັ້ນ',
    );
  }

  /** ຫົວໜ້າພະແນກອະນຸມັດຂັ້ນທີ 1 → ສົ່ງຕໍ່ເຂົ້າຄິວຝ່າຍສາງ (REQUESTED) */
  async managerApprove(id: string, user: PermissionUser, ip?: string) {
    const request = await this.findOne(id);
    const { substitute } = await this.assertCanReviewAsManager(request, user, 'APPROVE', ip);
    const before = request.toObject();
    request.status = SupplyRequestStatus.REQUESTED;
    request.managerApprovedBy = user.userId as any;
    request.managerApprovedAt = new Date();
    request.managerApprovedAsSubstitute = substitute;
    const saved = await request.save();
    await this.auditLogsService.log(
      user.userId!,
      substitute
        ? 'SUPPLY_REQUEST_MANAGER_APPROVED_AS_SUBSTITUTE'
        : 'SUPPLY_REQUEST_MANAGER_APPROVED',
      'SupplyRequest',
      id,
      before,
      saved.toObject(),
      ip,
    );
    await this.notifyRequesterOfManagerDecision(saved, true);
    await this.notifyApproversAwaiting(saved, String(saved.requestedBy));
    return saved;
  }

  /** ຫົວໜ້າພະແນກປະຕິເສດຂັ້ນທີ 1 — ຕ້ອງມີເຫດຜົນ; ປົດການຈອງ/ໃບສະເໜີຊື້ທີ່ຜູກຄືກັບການປະຕິເສດປົກກະຕິ */
  async managerReject(id: string, user: PermissionUser, reason: string, ip?: string) {
    const request = await this.findOne(id);
    const { substitute } = await this.assertCanReviewAsManager(request, user, 'REJECT', ip);
    const before = request.toObject();
    request.status = SupplyRequestStatus.REJECTED;
    request.rejectionReason = reason;
    request.managerRejectedBy = user.userId as any;
    request.managerRejectedAt = new Date();
    request.managerApprovedAsSubstitute = substitute;
    const saved = await request.save();
    await this.assetsService.releaseReservationsForRequest(id);
    await this.purchaseModel
      .updateMany(
        { supplyRequestId: id },
        { $unset: { supplyRequestId: 1, supplyRequestItemIndex: 1 } },
      )
      .exec();
    await this.auditLogsService.log(
      user.userId!,
      substitute
        ? 'SUPPLY_REQUEST_MANAGER_REJECTED_AS_SUBSTITUTE'
        : 'SUPPLY_REQUEST_MANAGER_REJECTED',
      'SupplyRequest',
      id,
      before,
      saved.toObject(),
      ip,
    );
    await this.notifyRequesterOfManagerDecision(saved, false);
    return saved;
  }

  private async notifyRequesterOfManagerDecision(
    request: SupplyRequestDocument,
    approved: boolean,
  ) {
    try {
      const id = String(request._id);
      await this.notificationsService.notify(
        String(request.requestedBy),
        approved ? 'SUPPLY_REQUEST_MANAGER_APPROVED' : 'SUPPLY_REQUEST_MANAGER_REJECTED',
        id,
        'SupplyRequest',
        approved
          ? `ຫົວໜ້າພະແນກອະນຸມັດຄຳຂໍ ${id} ແລ້ວ`
          : `ຫົວໜ້າພະແນກປະຕິເສດຄຳຂໍ ${id}`,
        approved
          ? 'ຄຳຂໍຖືກສົ່ງຕໍ່ໃຫ້ຝ່າຍສາງ/ຜູ້ອະນຸມັດແລ້ວ'
          : `ເຫດຜົນ: ${request.rejectionReason ?? '—'}`,
      );
    } catch {
      // decision is saved; a failed notification must not undo it
    }
  }

  async findRequestableDepartments(userId: string) {
    return this.departmentsService.findRequestableForUser(userId);
  }

  /**
   * ລາຍຊື່ຄົນທີ່ເລືອກເປັນ "ຜູ້ຮັບຜິດຊອບ" ຕອນສ້າງໃບຂໍໃນນາມແຜນກ (ຄົ້ນຫາຕາມຊື່/ລະຫັດ).
   * - ຜູ້ເອີ້ນຕ້ອງຂໍໃນນາມແຜນກນີ້ໄດ້ (ສະມາຊິກ ຫຼື ຫົວໜ້າ) — ກົດດຽວກັບ resolveDepartmentAssignment
   * - ຜົນລັບຈຳກັດສະເພາະສະມາຊິກ/ຫົວໜ້າຂອງແຜນກນັ້ນ ແລະ ຍັງໃຊ້ງານ — ຂໍ້ມູນຂັ້ນຕ່ຳເທົ່ານັ້ນ
   */
  async findCustodianCandidates(
    departmentId: string,
    q: string | undefined,
    userId: string,
  ) {
    if (!departmentId) throw new BadRequestException('departmentId is required');
    const requestable = await this.findRequestableDepartments(userId);
    if (!requestable.some((d) => String(d._id) === String(departmentId))) {
      throw new ForbiddenException(
        'ທ່ານບໍ່ມີສິດຂໍໃນນາມແຜນກນີ້',
      );
    }
    const department = await this.departmentsService.findOne(departmentId);
    const managerIds = (department?.managerIds ?? []).map(String);
    const users = await this.usersService.searchForPicker({
      q,
      restrictToDepartmentId: String(departmentId),
      alsoUserIds: managerIds,
      limit: 30,
    });
    return { users };
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
      // ໃບສ່ວນບຸກຄົນຂອງພະນັກງານໃນພະແນກທີ່ຕົນເປັນຫົວໜ້າ (ລໍຖ້າ/ຜ່ານຂັ້ນຫົວໜ້າ)
      scope.push({ managerDepartmentId: { $in: managedDepartmentIds } });
    }

    const docs = await this.requestModel
      .find({ $or: scope })
      .sort({ createdAt: -1 })
      .populate('requestedBy', 'firstName lastName email employeeCode')
      .populate('departmentId', 'name')
      .populate('custodianId', 'firstName lastName employeeCode')
      .populate('delegateId', 'firstName lastName employeeCode')
      .populate('approvedBy', 'firstName lastName employeeCode')
      .populate('managerApprovedBy', 'firstName lastName employeeCode')
      .populate('managerDepartmentId', 'name')
      .populate('fulfilledBy', 'firstName lastName employeeCode')
      .populate('receivedBy', 'firstName lastName employeeCode')
      .populate('receiveOverride.by', 'firstName lastName employeeCode')
      .exec();
    return this.attachPurchaseStatus(docs);
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
  async findAll(status?: SupplyRequestStatus, requestedBy?: string) {
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (requestedBy) filter.requestedBy = requestedBy;
    // ໃບທີ່ລໍຖ້າຫົວໜ້າພະແນກ ຍັງບໍ່ເຂົ້າຄິວຝ່າຍສາງ — ຜູ້ມີສິດ approve/fulfill/manage ບໍ່ເຫັນຜ່ານ list ນີ້
    // (ເຈົ້າຂອງໃບເຫັນຂອງຕົນເອງຜ່ານ /my ແລະ filter requestedBy)
    if (!requestedBy) {
      if (status === SupplyRequestStatus.PENDING_MANAGER) return [];
      if (!status) filter.status = { $ne: SupplyRequestStatus.PENDING_MANAGER };
    }
    const docs = await this.requestModel
      .find(filter)
      .sort({ createdAt: -1 })
      .populate('requestedBy', 'firstName lastName email employeeCode')
      .populate('departmentId', 'name')
      .populate('custodianId', 'firstName lastName employeeCode')
      .populate('delegateId', 'firstName lastName employeeCode')
      .populate('managerApprovedBy', 'firstName lastName employeeCode')
      .populate('managerDepartmentId', 'name')
      .exec();
    // ໃສ່ purchaseStatus ໃຫ້ລາຍການທີ່ຜູກໃບສະເໜີຊື້ — ໜ້າອະນຸມັດໃຊ້ສະແດງສະຖານະໃບສະເໜີຊື້
    return this.attachPurchaseStatus(docs);
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
    if (
      request.status === SupplyRequestStatus.PENDING_MANAGER &&
      expected === SupplyRequestStatus.REQUESTED
    ) {
      throw new BadRequestException(
        'ຄຳຂໍນີ້ຍັງລໍຖ້າຫົວໜ້າພະແນກອະນຸມັດຂັ້ນທຳອິດ — ຜູ້ອະນຸມັດຝ່າຍສາງຍັງດຳເນີນການບໍ່ໄດ້',
      );
    }
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
    await this.checkApprovable(request, approverId, ip);
    // ຄຳຂໍທີ່ຜູກກັບໃບສະເໜີຊື້: ຕ້ອງອະນຸມັດຜ່ານໃບສະເໜີຊື້ (ອະນຸມັດພ້ອມກັນ) ຫຼືໃບສະເໜີຖືກອະນຸມັດແລ້ວ
    await this.assertLinkedPurchasesApproved(request);
    return this.applyApproval(request, approverId, ip);
  }

  /** ໃຊ້ໂດຍ PurchaseRequestsService ກ່ອນອະນຸມັດໃບສະເໜີ — ກວດວ່າຄຳຂໍທີ່ຜູກຢູ່ອະນຸມັດໄດ້ແທ້ */
  async assertApprovableWithPurchase(id: string, approverId: string, ip?: string) {
    const request = await this.findOne(id);
    this.assertStatus(request, SupplyRequestStatus.REQUESTED);
    await this.checkApprovable(request, approverId, ip);
    return request;
  }

  /** ອະນຸມັດຄຳຂໍພ້ອມໃບສະເໜີຊື້ທີ່ຜູກ (ໃບສະເໜີຖືກອະນຸມັດໄປແລ້ວ) */
  async approveWithPurchase(id: string, approverId: string, ip?: string) {
    const request = await this.findOne(id);
    this.assertStatus(request, SupplyRequestStatus.REQUESTED);
    await this.checkApprovable(request, approverId, ip);
    return this.applyApproval(request, approverId, ip);
  }

  /** ໃບສະເໜີຊື້ທີ່ຜູກຕ້ອງຢູ່ໃນສະຖານະທີ່ຍັງຊື້ໄດ້ (ອະນຸມັດ/ຮັບບາງສ່ວນ/ຮັບຄົບ) */
  private async assertLinkedPurchasesApproved(request: SupplyRequestDocument) {
    for (const item of request.items) {
      if (!item.purchaseRequestId) continue;
      const pr = await this.purchaseModel.findById(item.purchaseRequestId).exec();
      const no = item.purchaseRequestNo ?? item.purchaseRequestId;
      if (!pr || pr.status === PurchaseRequestStatus.PENDING) {
        throw new BadRequestException(
          `ອະນຸມັດຄຳຂໍນີ້ໂດຍກົງບໍ່ໄດ້: ຜູກກັບໃບສະເໜີຊື້ ${no} ທີ່ຍັງລໍອະນຸມັດ — ກະລຸນາອະນຸມັດທີ່ໃບສະເໜີຊື້ (ຈະອະນຸມັດຄຳຂໍນີ້ພ້ອມກັນ)`,
        );
      }
      if (
        pr.status === PurchaseRequestStatus.REJECTED ||
        pr.status === PurchaseRequestStatus.CANCELLED
      ) {
        throw new BadRequestException(
          `ອະນຸມັດບໍ່ໄດ້: ໃບສະເໜີຊື້ ${no} ຖືກ${pr.status === PurchaseRequestStatus.REJECTED ? 'ປະຕິເສດ' : 'ຍົກເລີກ'}ແລ້ວ — ສ່ວນທີ່ສະຕັອກບໍ່ພໍຍັງບໍ່ມີທາງຈັດຫາ (ຄຳຂໍຍັງລໍຖ້າ ຫຼືປະຕິເສດຄຳຂໍນີ້)`,
        );
      }
    }
  }

  /** ກວດແຍກໜ້າທີ່ + ຜູກ Catalog ກ່ອນອະນຸມັດ */
  private async checkApprovable(
    request: SupplyRequestDocument,
    approverId: string,
    ip?: string,
  ) {
    const id = String(request._id);
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
  }

  private async applyApproval(
    request: SupplyRequestDocument,
    approverId: string,
    ip?: string,
  ) {
    const id = String(request._id);
    const before = request.toObject();

    // ມີລາຍການຜູກໃບສະເໜີຊື້ ແລະຂອງຍັງມາບໍ່ຄົບ → ORDERED (ລໍຂອງເຂົ້າສາງ); ຄົບແລ້ວ → APPROVED + ພ້ອມມາຮັບ
    const hasLinked = request.items.some((i) => !!i.purchaseRequestId);
    const waiting = this.hasPendingPurchase(request);
    request.status = waiting
      ? SupplyRequestStatus.ORDERED
      : SupplyRequestStatus.APPROVED;
    if (hasLinked && !waiting) request.readyToCollectAt = new Date();
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

    if (hasLinked) await this.notifyLinkedApproval(request);
    return saved;
  }

  // ───────────── ຮັບເຄື່ອງເຂົ້າຄັງ → ຈອງໃຫ້ຜູ້ຂໍ (ຕົວເລືອກ b: ຍັງຕ້ອງສະແກນຮັບຕາມປົກກະຕິ) ─────────────

  /**
   * ເອີ້ນຈາກ GoodsReceiptService ໃນ transaction ດຽວກັນກັບການຮັບເຄື່ອງ:
   * - ເພີ່ມຈຳນວນທີ່ມາຮອດ (arrivedQty) ຂອງລາຍການທີ່ຜູກ
   * - ຈອງຊັບສິນທີ່ຫາກໍຮັບເຂົ້າ (ຖ້າມີ Asset Tag) ໃຫ້ຄຳຂໍນີ້ — ບໍ່ມອບໃຫ້ອັດຕະໂນມັດ
   * - ເມື່ອຂອງມາຄົບທຸກລາຍການທີ່ຜູກ ແລະຄຳຂໍອະນຸມັດແລ້ວ → ສະຖານະ \"ພ້ອມມາຮັບ\" (APPROVED + readyToCollectAt)
   * ຄືນ null ຖ້າບໍ່ມີຄຳຂໍທີ່ຕ້ອງຈັດການ (ບໍ່ຜູກ/ປິດແລ້ວ/ຖືກປະຕິເສດ) — ເຄື່ອງເຂົ້າສະຕ໊ອກທົ່ວໄປ
   */
  async applyArrivalInTx(
    pr: PurchaseRequestDocument,
    quantity: number,
    assetIds: string[],
    session?: ClientSession,
  ) {
    if (!pr.supplyRequestId) return null;
    const request = await this.requestModel
      .findById(pr.supplyRequestId)
      .session(session ?? null)
      .exec();
    if (!request) return null;
    const handoverStatuses = [
      SupplyRequestStatus.REQUESTED,
      SupplyRequestStatus.APPROVED,
      SupplyRequestStatus.ORDERED,
      SupplyRequestStatus.PARTIALLY_RECEIVED,
    ];
    if (!handoverStatuses.includes(request.status)) return null;
    const item = request.items[pr.supplyRequestItemIndex ?? -1];
    if (!item || String(item.purchaseRequestId) !== String(pr._id)) return null;

    const before = request.toObject();
    const room = Math.max((item.purchaseQty ?? 0) - (item.arrivedQty ?? 0), 0);
    const arrive = Math.min(quantity, room);
    if (arrive <= 0) return null;
    item.arrivedQty = (item.arrivedQty ?? 0) + arrive;
    await this.assetsService.reserveForRequestInTx(
      assetIds.slice(0, arrive),
      String(request._id),
      session,
    );

    const awaitingApproval = request.status === SupplyRequestStatus.REQUESTED;
    let becameReady = false;
    if (
      !awaitingApproval &&
      request.status === SupplyRequestStatus.ORDERED &&
      !this.hasPendingPurchase(request)
    ) {
      request.status = SupplyRequestStatus.APPROVED;
      request.readyToCollectAt = new Date();
      becameReady = true;
    }
    request.markModified('items');
    const saved = await request.save({ session });
    return {
      requestId: String(request._id),
      requesterId: String(request.requestedBy),
      delegateId: request.delegateId ? String(request.delegateId) : undefined,
      itemName: item.name,
      purchaseRequestNo: pr.prNo,
      arrived: arrive,
      arrivedQty: item.arrivedQty ?? 0,
      purchaseQty: item.purchaseQty ?? 0,
      status: saved.status,
      awaitingApproval,
      becameReady,
      before,
      after: saved.toObject(),
    };
  }

  /** ແຈ້ງຜູ້ຂໍ (ແລະຜູ້ຮັບແທນ) ເມື່ອຂອງມາຮອດຄັງ — ເອີ້ນຫຼັງ commit; ລົ້ມເຫລວບໍ່ກະທົບການຮັບເຄື່ອງ */
  async notifyArrival(info: NonNullable<Awaited<ReturnType<SupplyRequestsService['applyArrivalInTx']>>>) {
    if (info.awaitingApproval) return;
    try {
      const recipients = new Set<string>([info.requesterId]);
      if (info.delegateId) recipients.add(info.delegateId);
      const progress = `${info.arrivedQty}/${info.purchaseQty}`;
      const title = info.becameReady
        ? `ພ້ອມມາຮັບເຄື່ອງ: ${info.requestId}`
        : `ຂອງມາແລ້ວບາງສ່ວນ: ${info.requestId}`;
      const body = info.becameReady
        ? `ຂອງຕາມຄຳຂໍ ${info.requestId} ມາຮອດຄັງຄົບແລ້ວ ແລະຖືກຈອງໄວ້ໃຫ້ — ມາສະແກນຮັບໄດ້ເລີຍ`
        : `${info.itemName} ຕາມຄຳຂໍ ${info.requestId} (${info.purchaseRequestNo}) ມາຮອດແລ້ວ ${progress} — ຍັງລໍສ່ວນທີ່ເຫຼືອ`;
      for (const userId of recipients) {
        await this.notificationsService.notify(
          userId,
          info.becameReady
            ? 'SUPPLY_REQUEST_READY_TO_COLLECT'
            : 'SUPPLY_REQUEST_PARTIAL_ARRIVAL',
          info.requestId,
          'SupplyRequest',
          title,
          body,
        );
      }
    } catch {
      // the goods receipt is committed; a failed notification must not undo it
    }
  }

  /** ແຈ້ງຜູ້ຂໍຫຼັງຄຳຂໍທີ່ຜູກກັບໃບສະເໜີຊື້ຖືກອະນຸມັດ (ລໍຂອງ ຫຼື ພ້ອມມາຮັບ) */
  private async notifyLinkedApproval(request: SupplyRequestDocument) {
    try {
      const waiting = this.hasPendingPurchase(request);
      await this.notificationsService.notify(
        String(request.requestedBy),
        'SUPPLY_REQUEST_APPROVED',
        String(request._id),
        'SupplyRequest',
        `ຄຳຂໍເບີກໄດ້ຮັບອະນຸມັດ: ${request._id}`,
        waiting
          ? `ຄຳຂໍ ${request._id} ໄດ້ຮັບອະນຸມັດພ້ອມໃບສະເໜີຊື້ — ລໍຂອງເຂົ້າຄັງ ຈະແຈ້ງອີກຄັ້ງເມື່ອພ້ອມມາຮັບ`
          : `ຄຳຂໍ ${request._id} ໄດ້ຮັບອະນຸມັດ ແລະຂອງມາຄົບແລ້ວ — ມາສະແກນຮັບໄດ້ເລີຍ`,
      );
    } catch {
      // approval is saved; a failed notification must not undo it
    }
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

    // ປົດການຈອງຊັບສິນ ແລະ ປົດໃບສະເໜີຊື້ທີ່ຜູກ (ໃບສະເໜີຍັງຢູ່ ແຕ່ບໍ່ເຮັດຫຍັງກັບຄຳຂໍນີ້ອີກ)
    await this.assetsService.releaseReservationsForRequest(id);
    await this.purchaseModel
      .updateMany(
        { supplyRequestId: id },
        { $unset: { supplyRequestId: 1, supplyRequestItemIndex: 1 } },
      )
      .exec();

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
    if (this.hasPendingPurchase(request)) {
      throw new BadRequestException(
        'ຂອງຍັງມາບໍ່ຄົບຕາມໃບສະເໜີຊື້ທີ່ຜູກ — ເບີກຈ່າຍບໍ່ໄດ້ຈົນກວ່າຈະ \"ພ້ອມມາຮັບ\"',
      );
    }
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
    const [obj] = await this.attachPurchaseStatus([request.toObject()]);
    // ຂອງຍັງມາບໍ່ຄົບ (ລໍໃບສະເໜີຊື້) → ຍັງຢືນຢັນຮັບບໍ່ໄດ້
    const waitingForPurchase = isOpen && this.hasPendingPurchase(request);
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
      waitingForPurchase,
      readyToCollect: isOpen && !waitingForPurchase && !!obj.readyToCollectAt,
      canConfirm:
        isOpen && !waitingForPurchase && (isAuthorizedCollector || canOverride),
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
      if (this.hasPendingPurchase(request)) {
        const waiting = request.items
          .filter(
            (i) => !!i.purchaseRequestId && (i.arrivedQty ?? 0) < (i.purchaseQty ?? 0),
          )
          .map(
            (i) =>
              `${i.name} (${i.purchaseRequestNo}: ມາແລ້ວ ${i.arrivedQty ?? 0}/${i.purchaseQty})`,
          );
        throw new BadRequestException(
          `ຂອງຍັງມາບໍ່ຄົບ — ຍັງຮັບບໍ່ໄດ້ຈົນກວ່າຈະມີສະຖານະ \"ພ້ອມມາຮັບ\": ${waiting.join(', ')}`,
        );
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
        if (asset.reservedForRequestId && asset.reservedForRequestId !== id) {
          issues.push(
            `"${tag}": ຖືກຈອງໄວ້ສຳລັບຄຳຂໍເບີກ ${asset.reservedForRequestId} — ໃຊ້ກັບຄຳຂໍນີ້ບໍ່ໄດ້`,
          );
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
          id,
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

      // ຊັບສິນທີ່ຈອງໄວ້ແຕ່ບໍ່ໄດ້ຖືກສະແກນ (ຮັບຊິ້ນອື່ນແທນ) → ປົດການຈອງ ກັບຄືນເປັນສະຕ໊ອກທົ່ວໄປ
      await this.assetsService.releaseReservationsForRequest(id, session);

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
