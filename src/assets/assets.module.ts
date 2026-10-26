import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Asset, AssetSchema } from './schemas/asset.schema';
import { AssetsService } from './assets.service';
import { AssetsController } from './assets.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MaintenanceHistoryModule } from '../maintenance-history/maintenance-history.module';
import { SupplyCatalogModule } from '../supply-catalog/supply-catalog.module';
import {
  SupplyRequest,
  SupplyRequestSchema,
} from '../supply-requests/schemas/supply-request.schema';
import { UsersModule } from '../users/users.module';
import { Counter, CounterSchema } from '../roles/schemas/counter.schema';
import {
  Department,
  DepartmentSchema,
} from '../departments/schemas/department.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Asset.name, schema: AssetSchema },
      { name: Counter.name, schema: CounterSchema },
      // ໃຊ້ກວດພະແນກ/ຫົວໜ້າ ຕອນມອບໃຫ້ພະແນກ (schema ເທົ່ານັ້ນ ບໍ່ import DepartmentsModule)
      { name: Department.name, schema: DepartmentSchema },
      // ໃຊ້ອ່ານໃບຂໍທີ່ອະນຸມັດແລ້ວ ເພື່ອກວດສິດ claim (schema ເທົ່ານັ້ນ ບໍ່ import SupplyRequestsModule ເພື່ອບໍ່ໃຫ້ວົງກົມ)
      { name: SupplyRequest.name, schema: SupplyRequestSchema },
    ]),
    AuditLogsModule,
    MaintenanceHistoryModule,
    SupplyCatalogModule,
    UsersModule,
  ],
  controllers: [AssetsController],
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}