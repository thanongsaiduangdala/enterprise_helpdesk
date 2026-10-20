import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CancelForMaintenanceDto {
  @ApiProperty({ example: ['RB001', 'RB002'] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  ids!: string[];

  @ApiPropertyOptional({ example: 'ຫ້ອງປິດບຳລຸງ' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
