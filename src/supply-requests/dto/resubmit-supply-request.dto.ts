import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

class ResubmitItemDto {
  @ApiProperty({ example: 'Computer with a high spec for 3D rendering' })
  @IsNotEmpty()
  @IsString()
  name!: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ example: 'A new employee does not have one' })
  @IsNotEmpty({ message: 'reason is required for every item' })
  @IsString()
  reason!: string;
}

/** Employee edits the list after the manager asked for changes, then sends it again. */
export class ResubmitSupplyRequestDto {
  @ApiProperty({ type: [ResubmitItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ResubmitItemDto)
  items!: ResubmitItemDto[];

  @ApiPropertyOptional({ description: 'Optional message back to the manager' })
  @IsOptional()
  @IsString()
  note?: string;
}
