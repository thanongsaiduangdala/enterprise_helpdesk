import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Role, RoleSchema } from './schemas/role.schema';
import { Counter, CounterSchema } from './schemas/counter.schema';
import { RolesService } from './roles.service';
import { RolesController } from './roles.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Role.name, schema: RoleSchema },
            { name: Counter.name, schema: CounterSchema },
        ]),
        AuditLogsModule,
    ],
    controllers: [RolesController],
    providers: [RolesService],
    exports: [RolesService],
})
export class RolesModule { }