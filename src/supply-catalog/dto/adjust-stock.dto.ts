import { IsInt, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AdjustStockDto {
  @ApiProperty({
    example: -5,
    description: 'Positive to add stock, negative to deduct',
  })
  @IsInt()
  delta!: number;

  @ApiPropertyOptional({
    example: 'restock from supplier',
    description: 'Reason recorded in the audit log',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
