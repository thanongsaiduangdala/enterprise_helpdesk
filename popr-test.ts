import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PoprService } from './src/popr/popr.service';
import { PoprStatus } from './src/popr/schemas/popr-record.schema';
import { AuditLogsService } from './src/audit-logs/audit-logs.service';
import { Connection } from 'mongoose';
import { getConnectionToken } from '@nestjs/mongoose';

const TAG = 'DIAG-PO-' + Date.now();

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const popr = app.get(PoprService);
  const audits = app.get(AuditLogsService);
  const conn = app.get<Connection>(getConnectionToken());
  const db: any = conn.db!;

  const created: string[] = [];
  const u = await db.collection('users').findOne({}, { projection: { _id: 1 } });
  const actor: string = String(u?._id);
  console.log('actor:', actor);

  const base = {
    itemType: 'CONSUMABLE' as any,
    stage: 1,
    procurement: {
      itemName: TAG + '-PAPER',
      spec: 'A4',
      category: 'DIAG',
      unit: 'ream',
      budget: 1000,
      price: 100,
      poNumber: TAG + '-PO',
      poTotalQuantity: 5,
      lotNo: 1,
      vendor: 'DIAG Vendor',
    },
    receiving: { receivedDate: new Date().toISOString(), receivedQuantity: 2 },
  };

  // 1) create lot1, complete -> received 2/5, no warning
  const r1 = await popr.create(
    { ...base, status: PoprStatus.COMPLETED } as any,
    actor,
  );
  created.push(r1._id);
  console.log('1) lot1 completed, status=', r1.status, 'delta=', r1.appliedStockDelta);

  // 2) create lot2 same PO / same attrs (should be ALLOWED now)
  const r2 = await popr.create(
    {
      ...base,
      procurement: { ...base.procurement, lotNo: 2 },
      receiving: { receivedDate: new Date().toISOString(), receivedQuantity: 2 },
      status: PoprStatus.COMPLETED,
    } as any,
    actor,
  );
  created.push(r2._id);
  console.log('2) lot2 completed (dup PO allowed), status=', r2.status);

  // 3) create lot3 same PO but DIFFERENT vendor -> must be REJECTED
  try {
    const r3 = await popr.create(
      {
        ...base,
        procurement: {
          ...base.procurement,
          lotNo: 3,
          vendor: 'OTHER Vendor',
        },
        status: PoprStatus.DRAFT,
      } as any,
      actor,
    );
    created.push(r3._id);
    console.log('3) ERROR: dup PO with different vendor was ALLOWED');
  } catch (e: any) {
    console.log('3) OK rejected inconsistent PO:', e.message);
  }

  // 4) lot4 same PO, received 3 -> total received 2+2+3=7 > 5 -> OVER_RECEIVED audit
  const before = Date.now();
  const r4 = await popr.create(
    {
      ...base,
      procurement: { ...base.procurement, lotNo: 4 },
      receiving: { receivedDate: new Date().toISOString(), receivedQuantity: 3 },
      status: PoprStatus.COMPLETED,
    } as any,
    actor,
  );
  created.push(r4._id);
  const over = await db
    .collection('auditlogs')
    .findOne({ action: 'POPR_PO_OVER_RECEIVED', timestamp: { $gte: new Date(before) } });
  console.log('4) over-received audit:', over ? JSON.stringify(over.after) : 'NONE');

  // 5) budget: price 100 * received(2+2+3=7)=700 < 1000 -> no budget warning. Make budget small instead
  //    create a fresh PO with budget 100 and 2 lots of received 2 each -> cost 100*2+... 
  const po2 = TAG + '-PO2';
  const b2 = {
    ...base,
    procurement: { ...base.procurement, poNumber: po2, poTotalQuantity: 10, budget: 150 },
  };
  const r5 = await popr.create(
    { ...b2, status: PoprStatus.COMPLETED, receiving: { receivedDate: new Date().toISOString(), receivedQuantity: 1 } } as any,
    actor,
  );
  created.push(r5._id);
  const beforeB = Date.now();
  const r6 = await popr.create(
    { ...b2, procurement: { ...b2.procurement, lotNo: 2 }, status: PoprStatus.COMPLETED, receiving: { receivedDate: new Date().toISOString(), receivedQuantity: 3 } } as any,
    actor,
  );
  created.push(r6._id);
  const bud = await db
    .collection('auditlogs')
    .findOne({ action: 'POPR_BUDGET_EXCEEDED', timestamp: { $gte: new Date(beforeB) } });
  console.log('5) budget-exceeded audit:', bud ? JSON.stringify(bud.after) : 'NONE');

  // 6) closePoShort on lot2
  const csBefore = Date.now();
  const cs = await popr.closePoShort(r2._id, 'ຜູ້ສະໜອງສົ່ງບໍ່ຄົບ', actor);
  console.log('6) closePoShort:', cs.poClosedShort, 'reason=', cs.poClosedReason);
  const csAudit = await db
    .collection('auditlogs')
    .findOne({ action: 'POPR_PO_CLOSED_SHORT', timestamp: { $gte: new Date(csBefore) } });
  console.log('6) close audit poSummary:', csAudit ? JSON.stringify((csAudit.after as any).poSummary) : 'NONE');

  // 7) purchasePrice on created assets (consume? no - assets only for non-consumable)
  //    create ELECTRONIC lot with price -> check asset.purchasePrice
  const r7 = await popr.create(
    {
      itemType: 'ELECTRONIC',
      stage: 1,
      procurement: {
        itemName: TAG + '-LAPTOP',
        spec: 'i5',
        category: 'DIAG',
        unit: 'pcs',
        budget: 50000000,
        price: 15000000,
        poNumber: TAG + '-PO3',
        poTotalQuantity: 1,
        lotNo: 1,
        vendor: 'DIAG Vendor',
      },
      receiving: {
        receivedDate: new Date().toISOString(),
        snMatch: true,
        units: [{ serialNumber: TAG + '-SN1' }],
      },
      preparation: { os: 'Win11', secAntivirus: true },
      release: { storeInStock: true },
      status: PoprStatus.COMPLETED,
    } as any,
    actor,
  );
  created.push(r7._id);
  const assetId = (r7.appliedAssetIds ?? [])[0];
  const asset = assetId
    ? await db.collection('assets').findOne({ _id: assetId })
    : null;
  console.log('7) asset purchasePrice:', asset?.purchasePrice, 'id=', assetId);

  // cleanup
  await db.collection('poprrecords').deleteMany({ _id: { $in: created } });
  await db
    .collection('assets')
    .deleteMany({ serialNumber: { $regex: '^' + TAG } });
  await db.collection('supplycatalogitems').deleteMany({ name: { $regex: '^' + TAG } });
  await db.collection('auditlogs').deleteMany({
    $or: [
      { entityId: { $in: created } },
      { 'after.poNumber': { $regex: '^' + TAG } },
    ],
  });
  console.log('cleanup done. created', created.length);

  await app.close();
}
main().catch((e) => {
  console.error('ERR:', e?.message ?? e);
  process.exit(1);
});
