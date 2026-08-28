import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Branch, BranchSchema } from './schemas/branch.schema';
import { BranchesService } from './branches.service';
import { BranchesController } from './branches.controller';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: Branch.name, schema: BranchSchema }]),
    ],
    controllers: [BranchesController],
    providers: [BranchesService],
    exports: [BranchesService],
})
export class BranchesModule { }