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

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PurchaseRequest.name, schema: PurchaseRequestSchema },
      { name: Counter.name, schema: CounterSchema },
    ]),
    SupplyCatalogModule,
    AuditLogsModule,
  ],
  controllers: [PurchaseRequestsController],
  providers: [PurchaseRequestsService],
  exports: [PurchaseRequestsService],
})
export class PurchaseRequestsModule {}
