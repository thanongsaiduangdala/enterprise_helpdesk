import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ReopenPoprRecordDto {
  @ApiProperty({ example: 'ຂໍແກ້ໄຂເລກ S/N ທີ່ພິມຜິດ' })
  @IsString()
  @MinLength(3)
  reason!: string;
}
