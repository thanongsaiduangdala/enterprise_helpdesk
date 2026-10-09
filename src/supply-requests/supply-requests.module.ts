import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SupplyRequest, SupplyRequestSchema } from './schemas/supply-request.schema';
import { SupplyRequestsService } from './supply-requests.service';
import { SupplyRequestsController } from './supply-requests.controller';
import { SupplyCatalogModule } from '../supply-catalog/supply-catalog.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AssetsModule } from '../assets/assets.module';
import { UsersModule } from '../users/users.module';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: SupplyRequest.name, schema: SupplyRequestSchema }]),
        SupplyCatalogModule,
        AuditLogsModule,
        AssetsModule,
        UsersModule,
    ],
    controllers: [SupplyRequestsController],
    providers: [SupplyRequestsService],
    exports: [SupplyRequestsService],
})
export class SupplyRequestsModule { }