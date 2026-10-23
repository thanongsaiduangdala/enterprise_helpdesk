import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GoodsReceipt, GoodsReceiptSchema } from './schemas/goods-receipt.schema';
import { GoodsReceiptService } from './goods-receipt.service';
import { GoodsReceiptController } from './goods-receipt.controller';
import { SupplyCatalogModule } from '../supply-catalog/supply-catalog.module';
import { AssetsModule } from '../assets/assets.module';
import { UsersModule } from '../users/users.module';
import { BranchesModule } from '../branches/branches.module';
import { Counter, CounterSchema } from '../roles/schemas/counter.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: GoodsReceipt.name, schema: GoodsReceiptSchema },
      { name: Counter.name, schema: CounterSchema },
    ]),
    SupplyCatalogModule,
    AssetsModule,
    UsersModule,
    BranchesModule,
  ],
  controllers: [GoodsReceiptController],
  providers: [GoodsReceiptService],
})
export class GoodsReceiptModule {}