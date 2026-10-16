import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ClaimAssetDto {
  @ApiPropertyOptional({ example: 'Claimed by scanning the asset QR code' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({
    example: 'EMP001',
    description:
      'Employee code to hand the asset over to (requires assets.assign); omit to claim for yourself',
  })
  @IsOptional()
  @IsString()
  assigneeCode?: string;
}
