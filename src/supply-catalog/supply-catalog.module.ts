import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SupplyCatalogItem, SupplyCatalogItemSchema } from './schemas/supply-catalog-item.schema';
import { SupplyCatalogService } from './supply-catalog.service';
import { SupplyCatalogController } from './supply-catalog.controller';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: SupplyCatalogItem.name, schema: SupplyCatalogItemSchema }]),
    ],
    controllers: [SupplyCatalogController],
    providers: [SupplyCatalogService],
    exports: [SupplyCatalogService], // exported so SupplyRequestsModule can decrement stock on fulfillment
})
export class SupplyCatalogModule { }
