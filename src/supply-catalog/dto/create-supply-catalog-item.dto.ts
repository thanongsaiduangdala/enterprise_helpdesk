import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
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
    example: true,
    description:
      'ASSET only: true = ຕ້ອງມີ Serial Number; false = ຕິດ Asset Tag ໂດຍບໍ່ມີ S/N (default true)',
  })
  @IsOptional()
  @IsBoolean()
  trackSerial?: boolean;

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

  @ApiPropertyOptional({
    example: '/api/uploads/0123456789abcdef0123456789abcdef.jpg',
    description: 'ຮູບລາຍການ (ອັບໂຫຼດຜ່ານ /api/uploads) — ສົ່ງຄ່າວ່າງເພື່ອລຶບຮູບ',
  })
  @IsOptional()
  @IsString()
  @Matches(/^(\/api\/uploads\/[a-f0-9]{32}\.(png|jpe?g|gif|webp))?$/i, {
    message: 'ຮູບລາຍການບໍ່ຖືກຕ້ອງ (ຮອງຮັບ png, jpg, gif, webp)',
  })
  imageUrl?: string;
}
