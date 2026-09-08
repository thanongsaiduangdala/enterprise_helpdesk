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
    ) { }



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
        const lastEntry = await this.auditLogModel.findOne().sort({ _id: -1 }).exec();
        const prevHash = lastEntry ? lastEntry.hash : GENESIS_HASH;
        const timestamp = new Date();

        const hash = this.computeHash({ actorId, action, entityType, entityId, before, after, ip, timestamp, prevHash });

        return this.auditLogModel.create({
            actorId, action, entityType, entityId, before, after, ip, timestamp, hash, prevHash,
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
        return this.auditLogModel.find(query).sort({ timestamp: -1 }).exec();
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
            const recomputed = this.computeHash({
                actorId: entry.actorId.toString(),
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
                return { valid: false, brokenAtId: entry._id, reason: 'prevHash does not match the actual previous entry\'s hash' };
            }
            if (entry.hash !== recomputed) {
                return { valid: false, brokenAtId: entry._id, reason: 'stored hash does not match recomputed hash — this entry\'s content was altered' };
            }

            expectedPrevHash = entry.hash;
        }

        return { valid: true, entriesChecked: entries.length };
    }
}
