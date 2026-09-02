import { PartialType } from '@nestjs/swagger';
import { CreateSupplyCatalogItemDto } from './create-supply-catalog-item.dto';

export class UpdateSupplyCatalogItemDto extends PartialType(CreateSupplyCatalogItemDto) { }
