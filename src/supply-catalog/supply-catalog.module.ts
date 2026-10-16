import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  SupplyCatalogItem,
  SupplyCatalogItemSchema,
} from './schemas/supply-catalog-item.schema';
import { SupplyCatalogService } from './supply-catalog.service';
import { SupplyCatalogController } from './supply-catalog.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SupplyCatalogItem.name, schema: SupplyCatalogItemSchema },
    ]),
    AuditLogsModule,
  ],
  controllers: [SupplyCatalogController],
  providers: [SupplyCatalogService],
  exports: [SupplyCatalogService],
})
export class SupplyCatalogModule {}
