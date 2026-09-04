import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Branch, BranchSchema } from './schemas/branch.schema';
import { BranchesService } from './branches.service';
import { BranchesController } from './branches.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: Branch.name, schema: BranchSchema }]),
        AuditLogsModule,
    ],
    controllers: [BranchesController],
    providers: [BranchesService],
    exports: [BranchesService],
})
export class BranchesModule { }