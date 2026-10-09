import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Asset, AssetSchema } from './schemas/asset.schema';
import { AssetsService } from './assets.service';
import { AssetsController } from './assets.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MaintenanceHistoryModule } from '../maintenance-history/maintenance-history.module';
import { SupplyCatalogModule } from '../supply-catalog/supply-catalog.module';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: Asset.name, schema: AssetSchema }]),
        AuditLogsModule,
        MaintenanceHistoryModule,
        SupplyCatalogModule,
    ],
    controllers: [AssetsController],
    providers: [AssetsService],
    exports: [AssetsService],
})
export class AssetsModule { }