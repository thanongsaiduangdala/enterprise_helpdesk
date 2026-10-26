import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NewItemInfoDto } from '../../goods-receipt/dto/goods-receipt.dto';
import { PurchaseRequestMode } from '../schemas/purchase-request.schema';

export class CreatePurchaseRequestDto {
  @ApiProperty({ enum: PurchaseRequestMode })
  @IsEnum(PurchaseRequestMode, { message: 'ປະເພດໃບສະເໜີບໍ່ຖືກຕ້ອງ' })
  mode!: PurchaseRequestMode;

  @ApiPropertyOptional({ example: 'SC001', description: 'ສຳລັບ RESTOCK' })
  @IsOptional()
  @IsString()
  catalogItemId?: string;

  @ApiPropertyOptional({ type: NewItemInfoDto, description: 'ສຳລັບ NEW_ITEM' })
  @IsOptional()
  @ValidateNested()
  @Type(() => NewItemInfoDto)
  item?: NewItemInfoDto;

  @ApiProperty({ example: 20 })
  @Type(() => Number)
  @IsInt({ message: 'ຈຳນວນຕ້ອງເປັນຈຳນວນເຕັມ' })
  @Min(1, { message: 'ຈຳນວນຕ້ອງຢ່າງໜ້ອຍ 1' })
  @Max(1000, { message: 'ຈຳນວນຕ້ອງບໍ່ເກີນ 1000' })
  quantity!: number;

  @ApiPropertyOptional({ description: 'ລາຄາຕໍ່ໜ່ວຍໂດຍປະມານ' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'ລາຄາຕ້ອງເປັນຕົວເລກ' })
  @Min(0, { message: 'ລາຄາຕ້ອງບໍ່ຕິດລົບ' })
  estimatedUnitPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  vendor?: string;

  @ApiProperty({ description: 'ເຫດຜົນ / ຄວາມຈຳເປັນ' })
  @IsNotEmpty({ message: 'ກະລຸນາໃສ່ເຫດຜົນ' })
  @IsString()
  @MinLength(3, { message: 'ເຫດຜົນຕ້ອງຢ່າງໜ້ອຍ 3 ຕົວອັກສອນ' })
  @MaxLength(1000)
  reason!: string;

  @ApiPropertyOptional({ example: '2026-11-15' })
  @IsOptional()
  @IsDateString({}, { message: 'ວັນທີຕ້ອງການບໍ່ຖືກຕ້ອງ' })
  neededBy?: string;
}

export class RejectPurchaseRequestDto {
  @ApiProperty()
  @IsNotEmpty({ message: 'ກະລຸນາໃສ່ເຫດຜົນທີ່ປະຕິເສດ' })
  @IsString()
  @MinLength(3, { message: 'ເຫດຜົນຕ້ອງຢ່າງໜ້ອຍ 3 ຕົວອັກສອນ' })
  @MaxLength(1000)
  reason!: string;
}
