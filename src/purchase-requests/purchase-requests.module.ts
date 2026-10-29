import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PurchaseRequest,
  PurchaseRequestSchema,
} from './schemas/purchase-request.schema';
import { PurchaseRequestsService } from './purchase-requests.service';
import { PurchaseRequestsController } from './purchase-requests.controller';
import { SupplyCatalogModule } from '../supply-catalog/supply-catalog.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { Counter, CounterSchema } from '../roles/schemas/counter.schema';
import { GoodsReceipt, GoodsReceiptSchema } from '../goods-receipt/schemas/goods-receipt.schema';
import {
  SupplyRequest,
  SupplyRequestSchema,
} from '../supply-requests/schemas/supply-request.schema';
import { SupplyRequestsModule } from '../supply-requests/supply-requests.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PurchaseRequest.name, schema: PurchaseRequestSchema },
      { name: Counter.name, schema: CounterSchema },
      { name: GoodsReceipt.name, schema: GoodsReceiptSchema },
      { name: SupplyRequest.name, schema: SupplyRequestSchema },
    ]),
    SupplyCatalogModule,
    AuditLogsModule,
    SupplyRequestsModule,
    NotificationsModule,
  ],
  controllers: [PurchaseRequestsController],
  providers: [PurchaseRequestsService],
  exports: [PurchaseRequestsService],
})
export class PurchaseRequestsModule {}
