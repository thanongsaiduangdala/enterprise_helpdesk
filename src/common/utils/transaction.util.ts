import { Logger } from '@nestjs/common';
import { ClientSession, Connection } from 'mongoose';

const logger = new Logger('Transaction');

/** ເຫດການ audit ທີ່ຖືກເກັບໄວ້ ແລະບັນທຶກຫຼັງ transaction commit ສຳເລັດເທົ່ານັ້ນ (ຖ້າຍ້ອນກັບ ຈະບໍ່ມີ log ຜີ) */
export interface AuditEvent {
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    before?: Record<string, any>;
    after?: Record<string, any>;
    ip?: string;
}

/** ບໍລິບົດຂອງ transaction ທີ່ສົ່ງຕໍ່ລະຫວ່າງ service: session + ລາຍການ audit ທີ່ລໍບັນທຶກ */
export interface TxCtx {
    session?: ClientSession;
    audits: AuditEvent[];
}

/**
 * ຮັນ fn ພາຍໃນ MongoDB transaction — ສຳເລັດທັງໝົດ ຫຼື ຍ້ອນກັບທັງໝົດ.
 * - Atlas / replica set: ໃຊ້ transaction ຈິງ (ຖ້າຂັດແຍ້ງ ລະບົບຈະ retry ເອງ).
 * - mongod ແບບດ່ຽວ (ເຄື່ອງ dev) ບໍ່ຮອງຮັບ transaction: ຖອຍໄປຮັນປົກກະຕິ ແລະແຈ້ງເຕືອນໃນ log.
 *   ຕັ້ງ REQUIRE_TRANSACTIONS=true ເພື່ອບັງຄັບ (ແນະນຳໃນ production).
 */
export async function runInTransaction<T>(
    connection: Connection,
    fn: (session?: ClientSession) => Promise<T>,
): Promise<T> {
    const session = await connection.startSession();
    try {
        let result!: T;
        await session.withTransaction(async () => {
            result = await fn(session);
        });
        return result;
    } catch (err: any) {
        const unsupported =
            err?.code === 20 || /Transaction numbers are only allowed|replica set|Transactions are not supported/i.test(err?.message || '');
        if (unsupported && process.env.REQUIRE_TRANSACTIONS !== 'true') {
            logger.warn('Database does not support transactions — running without one. Set REQUIRE_TRANSACTIONS=true in production.');
            return fn(undefined);
        }
        throw err;
    } finally {
        await session.endSession();
    }
}
