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
import { SupplyCatalogService } from '../supply-catalog/supply-catalog.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { UsersService } from '../users/users.service';
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

@Injectable()
export class SupplyRequestsService {
  constructor(
    @InjectModel(SupplyRequest.name)
    private requestModel: Model<SupplyRequestDocument>,
    private catalogService: SupplyCatalogService,
    private auditLogsService: AuditLogsService,
    private usersService: UsersService,
    private assetsService: AssetsService,
    @InjectConnection() private connection: Connection,
  ) {}

  private async generateId(): Promise<string> {
    const requests = await this.requestModel
      .find({ _id: /^SR\d{3}$/ }, { _id: 1 })
      .sort({ _id: 1 })
      .exec();
    const usedNumbers = new Set(
      requests.map((r) => parseInt(r._id.slice(2), 10)),
    );
    let seq = 1;
    while (usedNumbers.has(seq)) seq++;
    return `SR${String(seq).padStart(3, '0')}`;
  }

  async create(dto: CreateSupplyRequestDto, requestedBy: string, ip?: string) {
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

  findMine(userId: string) {
    return this.requestModel
      .find({ requestedBy: userId })
      .sort({ createdAt: -1 })
      .populate('requestedBy', 'firstName lastName email employeeCode')
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

  async approve(id: string, approverId: string, ip?: string) {
    const request = await this.findOne(id);
    this.assertStatus(request, SupplyRequestStatus.REQUESTED);
    // ແຍກໜ້າທີ່: ຜູ້ຂໍອະນຸມັດໃບຂອງຕົນເອງບໍ່ໄດ້
    if (sodEnforced() && request.requestedBy.toString() === approverId) {
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
    this.assertStatus(request, SupplyRequestStatus.APPROVED);
    const before = request.toObject();

    // ລາຍການທີ່ມີ Asset Tag ຕ້ອງຮັບຜ່ານການສະແກນ (receive) ເພື່ອໃຫ້ທະບຽນຊັບສິນມີຜູ້ຮັບຜິດຊອບ — fulfill ປິດໃບແບບບໍ່ມີຄົນຮັບບໍ່ໄດ້
    const taggedFlags = await Promise.all(
      request.items.map((i) =>
        this.assetsService.hasAssetsForCatalog(i.catalogItemId),
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

    request.status = SupplyRequestStatus.FULFILLED;
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

  /**
   * ໃບຮັບເຄື່ອງ (ເປີດຈາກ QR ຂອງໃບຂໍ) — ຜູ້ຂໍ ຫຼື ຜູ້ມີສິດ supplies.fulfill ເທົ່ານັ້ນ
   */
  async getReceipt(id: string, user: PermissionUser) {
    const request = await this.requestModel
      .findById(id)
      .populate('requestedBy', 'firstName lastName employeeCode')
      .exec();
    if (!request) throw new NotFoundException('Supply request not found');

    const ref: any = request.requestedBy;
    const requesterId = String(ref?._id ?? ref);
    const elevated = hasAnyPermission(user, 'supplies', [
      'approve',
      'fulfill',
      'manage',
    ]);
    if (!elevated && requesterId !== user.userId) {
      throw new NotFoundException('Supply request not found');
    }

    const flags = await Promise.all(
      request.items.map((i) =>
        this.assetsService.hasAssetsForCatalog(i.catalogItemId),
      ),
    );
    const obj: any = request.toObject();
    return {
      ...obj,
      items: obj.items.map((it: any, k: number) => ({
        ...it,
        requiresAssetTag: flags[k],
      })),
      isRequester: requesterId === user.userId,
      canConfirm:
        request.status === SupplyRequestStatus.APPROVED &&
        (requesterId === user.userId ||
          hasPermission(user, 'supplies', 'fulfill')),
    };
  }

  /**
   * ຢືນຢັນຮັບເຄື່ອງທັງໃບໃນຄັ້ງດຽວ — ທຸກຢ່າງຢູ່ໃນ transaction ດຽວ (ສຳເລັດທັງໝົດ ຫຼືບໍ່ມີຫຍັງປ່ຽນ):
   * - ຜູ້ເຮັດ: ຜູ້ຂໍເອງ ຫຼື ຜູ້ມີ supplies.fulfill (ຜູ້ດູແລສາງ)
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
      this.assertStatus(request, SupplyRequestStatus.APPROVED);
      const actorId = user.userId;
      if (!actorId) {
        throw new BadRequestException('Not authenticated');
      }

      const requesterId = request.requestedBy.toString();
      const isRequester = actorId === requesterId;
      const canFulfill = hasPermission(user, 'supplies', 'fulfill');
      if (!isRequester && !canFulfill) {
        throw new ForbiddenException(
          'Only the requester (or warehouse staff with supplies.fulfill) can confirm receipt of this request',
        );
      }
      if (
        sodEnforced() &&
        !isRequester &&
        request.approvedBy &&
        String(request.approvedBy) === actorId
      ) {
        throw new ForbiddenException(
          'Segregation of duties: the approver of this request cannot also issue the equipment',
        );
      }

      // 1. ຜູ້ຮັບເຄື່ອງ — default ແມ່ນຜູ້ຂໍ
      let assigneeId = requesterId;
      if (dto.assigneeCode) {
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
        assigneeId = assignee._id.toString();
      }
      const allowedAssignee =
        (isRequester && assigneeId === actorId) ||
        hasPermission(user, 'assets', 'assign') ||
        (canFulfill && assigneeId === requesterId);
      if (!allowedAssignee) {
        throw new ForbiddenException(
          'Giving the equipment to another employee requires the "assets.assign" permission',
        );
      }

      // 2. ກວດ Asset Tag ກັບທະບຽນຊັບສິນ + ສະຖານະ AVAILABLE
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
        resolved.push(asset);
      }

      // 3. ຈັບຄູ່ຊັບສິນກັບລາຍການທີ່ຂໍ — ນັບລວມຊັບສິນທີ່ເຄີຍຮັບແລ້ວຕາມໃບນີ້ (ຜ່ານການສະແກນຮັບເປັນຊິ້ນ)
      const items = request.items;
      const catalogTagged = await Promise.all(
        items.map((i) =>
          this.assetsService.hasAssetsForCatalog(i.catalogItemId),
        ),
      );
      const prior = await this.assetsService.findManyByIds(
        request.receivedAssetIds ?? [],
        session,
      );
      const matched: number[] = items.map(() => 0);
      prior.forEach((p) => {
        const k = matchAssetToItem(items, p, matched);
        if (k >= 0) matched[k] += 1;
      });
      for (const asset of resolved) {
        const idx = matchAssetToItem(items, asset, matched);
        if (idx === -1) {
          issues.push(
            `"${asset.assetTag}": ຊະນິດ "${asset.type}" ບໍ່ກົງກັບລາຍການທີ່ຂໍ`,
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
      request.status = SupplyRequestStatus.FULFILLED;
      request.fulfilledBy = actorId as any;
      request.fulfilledAt = new Date();
      request.receivedBy = assigneeId as any;
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
      return savedRequest;
    });

    // audit ບັນທຶກຫຼັງ commit ສຳເລັດເທົ່ານັ້ນ
    await this.assetsService.flushAudits(audits);
    return saved;
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
