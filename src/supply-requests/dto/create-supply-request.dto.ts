import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class SupplyRequestItemDto {
  @ApiPropertyOptional({
    example: 'SC001',
    description: 'Omit for a free-text "other" item not in the catalog',
  })
  @IsOptional()
  @IsString()
  @Matches(/^SC\d{3}$/, { message: 'catalogItemId must look like SC001' })
  catalogItemId?: string;

  @ApiProperty({ example: 'Ballpoint Pen (Blue)' })
  @IsNotEmpty()
  @IsString()
  name!: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({ example: 'Ran out at my desk' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class CreateSupplyRequestDto {
  @ApiProperty({ type: [SupplyRequestItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SupplyRequestItemDto)
  items!: SupplyRequestItemDto[];

  @ApiPropertyOptional({
    example: 'DX001',
    description: 'Raise this request on behalf of a department',
  })
  @IsOptional()
  @Matches(/^DX\d{3}$/, { message: 'departmentId must look like DX001' })
  departmentId?: string;

  @ApiPropertyOptional({
    example: 'EMP001',
    description:
      'Employee code of the department custodian (required for department requests)',
  })
  @IsOptional()
  @IsString()
  custodianCode?: string;

  @ApiPropertyOptional({
    example: '665fbb1f2c1a4e3b9c8d0a11',
    description:
      'users._id of the department custodian (alternative to custodianCode)',
  })
  @IsOptional()
  @IsMongoId()
  custodianId?: string;

  @ApiPropertyOptional({
    example: 'EMP002',
    description:
      'Optional: employee code of the one person who will collect the items. Can also be set or changed later via PATCH /supply-requests/:id/delegate',
  })
  @IsOptional()
  @IsString()
  delegateCode?: string;
}
