import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReceiveCommonDto {
  @ApiProperty({ example: 10, description: 'ຈຳນວນຊິ້ນ (ຈຳນວນເຕັມ ≥ 1)' })
  @Type(() => Number)
  @IsInt({ message: 'ຈຳນວນຕ້ອງເປັນຈຳນວນເຕັມ' })
  @Min(1, { message: 'ຈຳນວນຕ້ອງຢ່າງໜ້ອຍ 1' })
  @Max(1000, { message: 'ຈຳນວນຕໍ່ຄັ້ງຕ້ອງບໍ່ເກີນ 1000' })
  quantity!: number;

  @ApiPropertyOptional({ example: '2026-10-22' })
  @IsOptional()
  @IsDateString({}, { message: 'ວັນທີຮັບບໍ່ຖືກຕ້ອງ' })
  receivedDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vendor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ type: [String], description: 'ສະເພາະອຸປະກອນ (DEVICE)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  serialNumbers?: string[];
}

export class RestockDto extends ReceiveCommonDto {
  @ApiProperty({ example: 'SC001' })
  @IsNotEmpty({ message: 'ກະລຸນາເລືອກລາຍການ' })
  @IsString()
  catalogItemId!: string;
}

export enum NewItemKind {
  DEVICE = 'DEVICE',
  CONSUMABLE = 'CONSUMABLE',
}

export class NewItemInfoDto {
  @ApiProperty()
  @IsNotEmpty({ message: 'ກະລຸນາໃສ່ຊື່ລາຍການ' })
  @IsString()
  name!: string;

  @ApiProperty()
  @IsNotEmpty({ message: 'ກະລຸນາໃສ່ໝວດໝູ່' })
  @IsString()
  category!: string;

  @ApiProperty()
  @IsNotEmpty({ message: 'ກະລຸນາໃສ່ໜ່ວຍນັບ' })
  @IsString()
  unit!: string;

  @ApiProperty({ enum: NewItemKind })
  @IsEnum(NewItemKind, { message: 'ປະເພດຕ້ອງເປັນ DEVICE ຫຼື CONSUMABLE' })
  type!: NewItemKind;
}

export class NewItemDto extends ReceiveCommonDto {
  @ApiProperty({ type: NewItemInfoDto })
  @ValidateNested()
  @Type(() => NewItemInfoDto)
  item!: NewItemInfoDto;
}
