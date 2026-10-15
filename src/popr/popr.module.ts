import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PoprRecord, PoprRecordSchema } from './schemas/popr-record.schema';
import { PoprService } from './popr.service';
import { PoprController } from './popr.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: PoprRecord.name, schema: PoprRecordSchema }]),
        AuditLogsModule,
    ],
    controllers: [PoprController],
    providers: [PoprService],
    exports: [PoprService],
})
export class PoprModule { }
