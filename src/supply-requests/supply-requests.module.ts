import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SupplyRequest, SupplyRequestSchema } from './schemas/supply-request.schema';
import { SupplyRequestsService } from './supply-requests.service';
import { SupplyRequestsController } from './supply-requests.controller';
import { SupplyCatalogModule } from '../supply-catalog/supply-catalog.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: SupplyRequest.name, schema: SupplyRequestSchema }]),
        SupplyCatalogModule, // one-directional dependency — no forwardRef needed, unlike rooms/room-bookings
        AuditLogsModule,
    ],
    controllers: [SupplyRequestsController],
    providers: [SupplyRequestsService],
    exports: [SupplyRequestsService],
})
export class SupplyRequestsModule { }