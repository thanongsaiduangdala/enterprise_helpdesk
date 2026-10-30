import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  SupplyCatalogItem,
  SupplyCatalogItemSchema,
} from './schemas/supply-catalog-item.schema';
import { SupplyCatalogService } from './supply-catalog.service';
import { SupplyCatalogController } from './supply-catalog.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { Counter, CounterSchema } from '../roles/schemas/counter.schema';
import { Asset, AssetSchema } from '../assets/schemas/asset.schema';
import {
  SupplyRequest,
  SupplyRequestSchema,
} from '../supply-requests/schemas/supply-request.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SupplyCatalogItem.name, schema: SupplyCatalogItemSchema },
      { name: Counter.name, schema: CounterSchema },
      { name: Asset.name, schema: AssetSchema },
      { name: SupplyRequest.name, schema: SupplyRequestSchema },
    ]),
    AuditLogsModule,
  ],
  controllers: [SupplyCatalogController],
  providers: [SupplyCatalogService],
  exports: [SupplyCatalogService],
})
export class SupplyCatalogModule {}
