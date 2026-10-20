import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CatalogItemType } from '../schemas/supply-catalog-item.schema';

export class CreateSupplyCatalogItemDto {
  @ApiProperty({ example: 'Ballpoint Pen (Blue)' })
  @IsNotEmpty()
  @IsString()
  name!: string;

  @ApiProperty({ example: 'Stationery' })
  @IsNotEmpty()
  @IsString()
  category!: string;

  @ApiProperty({ example: 'pcs' })
  @IsNotEmpty()
  @IsString()
  unit!: string;

  @ApiPropertyOptional({
    enum: CatalogItemType,
    description:
      'ASSET = ສະຕ໊ອກນັບຈາກຊັບສິນວ່າງ; CONSUMABLE = ສະຕ໊ອກປັບດ້ວຍຕົວເລກ',
  })
  @IsOptional()
  @IsEnum(CatalogItemType)
  itemType?: CatalogItemType;

  @ApiPropertyOptional({
    example: 100,
    description: 'Initial stock quantity, defaults to 0',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  stockQty?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  lowStockThreshold?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
