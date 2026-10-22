import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';

const GENESIS_HASH = 'GENESIS';

@Injectable()
export class AuditLogsService {
  constructor(
    @InjectModel(AuditLog.name) private auditLogModel: Model<AuditLogDocument>,
  ) {}

  /**
   * ລັອກບັນທຶກ audit ໃຫ້ຮັນຕາມລຳດັບ (ອ່າງ queue ໜ່າ)
   * — ຖ້າບໍ່ລັອກ: 2 request ພ້ອມກັນຈະ "ອ່ານ chain head ເດີວ" ຄືກັນ
   *   → prevHash ຊີ້ລາງ (fork) → verifyChain ຂຶ້ນ "prevHash does not match".
   */
  private writeQueue: Promise<unknown> = Promise.resolve();

  private computeHash(entry: {
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    before?: Record<string, any>;
    after?: Record<string, any>;
    ip?: string;
    timestamp: Date;
    prevHash: string;
  }): string {
    const payload = JSON.stringify({
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: entry.before ?? null,
      after: entry.after ?? null,
      ip: entry.ip ?? null,
      timestamp: entry.timestamp.toISOString(),
      prevHash: entry.prevHash,
    });
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  async log(
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    before?: Record<string, any>,
    after?: Record<string, any>,
    ip?: string,
  ) {
    const run = this.writeQueue.then(
      () =>
        this.appendEntry(
          actorId,
          action,
          entityType,
          entityId,
          before,
          after,
          ip,
        ),
      () =>
        this.appendEntry(
          actorId,
          action,
          entityType,
          entityId,
          before,
          after,
          ip,
        ),
    );
    // ຫຼັງຄິວບໍ່ຕ້ອງເປັນ rejected (ບໍ່ເປັນຕົວຢ່າງ block ຄິວຕໍ່ໄປ)
    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async appendEntry(
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    before?: Record<string, any>,
    after?: Record<string, any>,
    ip?: string,
  ) {
    // ຫຼັງ chain ຈາກ entry ລ້າສຸດທີ່ "ມີ hash" ຈິງເທົ່າ
    // (entry ທີ່ຖືກ insert ນອກ collection ແລວ ບໍ່ມີ hash → ບໍ່ເປັນຕົວຢ່າງ prevHash ຂອງ chain ຫລາຍ)
    const lastEntry = await this.auditLogModel
      .findOne({ hash: { $exists: true, $nin: [null, ''] } })
      .sort({ _id: -1 })
      .exec();
    const prevHash = lastEntry?.hash || GENESIS_HASH;
    const timestamp = new Date();

    const hash = this.computeHash({
      actorId,
      action,
      entityType,
      entityId,
      before,
      after,
      ip,
      timestamp,
      prevHash,
    });

    return this.auditLogModel.create({
      actorId,
      action,
      entityType,
      entityId,
      before,
      after,
      ip,
      timestamp,
      hash,
      prevHash,
    });
  }

  findAll(filters: {
    actorId?: string;
    entityType?: string;
    entityId?: string;
    from?: Date;
    to?: Date;
  }) {
    const query: any = {};
    if (filters.actorId) query.actorId = filters.actorId;
    if (filters.entityType) query.entityType = filters.entityType;
    if (filters.entityId) query.entityId = filters.entityId;
    if (filters.from || filters.to) {
      query.timestamp = {};
      if (filters.from) query.timestamp.$gte = filters.from;
      if (filters.to) query.timestamp.$lte = filters.to;
    }
    return this.auditLogModel
      .find(query)
      .sort({ timestamp: -1 })
      .populate('actorId')
      .exec();
  }

  async findOne(id: string) {
    const entry = await this.auditLogModel.findById(id).exec();
    if (!entry) throw new NotFoundException('Audit log entry not found');
    return entry;
  }

  async verifyChain() {
    const entries = await this.auditLogModel.find().sort({ _id: 1 }).exec();

    let expectedPrevHash = GENESIS_HASH;
    for (const entry of entries) {
      // entry ທີ່ຖືກ insert ນອກ collection (ບໍ່ມີ hash/prevHash/timestamp) → ຢຸດເລີຍ ແຕ່ບໍ່ເປັນ 500
      if (!entry.hash || !entry.prevHash || !entry.timestamp) {
        return {
          valid: false,
          brokenAtId: entry._id,
          reason:
            'entry ຂາດ hash/prevHash/timestamp — ຖືກ insert ນອກ audit chain (chain ຢຸດເລີຍທີ່ນີ້)',
        };
      }

      const recomputed = this.computeHash({
        actorId: entry.actorId ? entry.actorId.toString() : '',
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: entry.before,
        after: entry.after,
        ip: entry.ip,
        timestamp: entry.timestamp,
        prevHash: entry.prevHash,
      });

      if (entry.prevHash !== expectedPrevHash) {
        return {
          valid: false,
          brokenAtId: entry._id,
          reason: "prevHash does not match the actual previous entry's hash",
        };
      }
      if (entry.hash !== recomputed) {
        return {
          valid: false,
          brokenAtId: entry._id,
          reason:
            "stored hash does not match recomputed hash — this entry's content was altered",
        };
      }

      expectedPrevHash = entry.hash;
    }

    return { valid: true, entriesChecked: entries.length };
  }
}
