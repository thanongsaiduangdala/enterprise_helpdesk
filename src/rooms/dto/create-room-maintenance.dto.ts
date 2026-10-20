import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRoomMaintenanceDto {
  @ApiProperty({ example: '2026-11-02T08:00:00.000Z' })
  @IsDateString()
  startAt!: string;

  @ApiProperty({ example: '2026-11-04T17:00:00.000Z' })
  @IsDateString()
  endAt!: string;

  @ApiPropertyOptional({ example: 'ສ້ອມແປງລະບົບແອ' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
