import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PoprRecord, PoprRecordSchema } from './schemas/popr-record.schema';
import { PoprService } from './popr.service';
import { PoprController } from './popr.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { UsersModule } from '../users/users.module';
import { AssetsModule } from '../assets/assets.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PoprRecord.name, schema: PoprRecordSchema },
    ]),
    AuditLogsModule,
    UsersModule,
    AssetsModule,
  ],
  controllers: [PoprController],
  providers: [PoprService],
  exports: [PoprService],
})
export class PoprModule {}
