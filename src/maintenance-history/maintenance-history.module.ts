import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  MaintenanceHistory,
  MaintenanceHistorySchema,
} from './schemas/maintenance-history.schema';
import { MaintenanceHistoryService } from './maintenance-history.service';
import { MaintenanceHistoryController } from './maintenance-history.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MaintenanceHistory.name, schema: MaintenanceHistorySchema },
    ]),
  ],
  providers: [MaintenanceHistoryService],
  controllers: [MaintenanceHistoryController],
  exports: [MaintenanceHistoryService],
})
export class MaintenanceHistoryModule {}
