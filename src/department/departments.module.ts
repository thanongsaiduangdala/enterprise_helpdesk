import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Department, DepartmentSchema } from './schemas/department.schema';
import { DepartmentsService } from './departments.service';
import { DepartmentsController } from './departments.controller';
import { BranchesModule } from '../branches/branches.module';
import { TicketTypesModule } from '../ticket-types/ticket-type.module';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: Department.name, schema: DepartmentSchema }]),
        BranchesModule,
        TicketTypesModule,
    ],
    controllers: [DepartmentsController],
    providers: [DepartmentsService],
    exports: [DepartmentsService],
})
export class DepartmentsModule { }