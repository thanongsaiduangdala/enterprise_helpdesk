import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export enum SupplyLineAction {
  /** Only link the line to a catalog item (no status change) */
  LINK = 'LINK',
  /** In stock: reserve it for the requester -> READY */
  AVAILABLE = 'AVAILABLE',
  /** Not in stock: mark as on order -> ON_ORDER (optionally link a purchase request) */
  ORDER = 'ORDER',
  /** Reject this line -> REJECTED (note required) */
  REJECT = 'REJECT',
}

export class ReviewSupplyLineDto {
  @ApiProperty({ example: 0, description: 'Index of the line in request.items' })
  @IsInt()
  @Min(0)
  index!: number;

  @ApiProperty({ enum: SupplyLineAction })
  @IsEnum(SupplyLineAction)
  action!: SupplyLineAction;

  @ApiPropertyOptional({ example: 'SC001', description: 'Catalog item picked from the Shopping page' })
  @IsOptional()
  @IsString()
  @Matches(/^SC\d{3}$/, { message: 'catalogItemId must look like SC001' })
  catalogItemId?: string;

  @ApiPropertyOptional({ description: 'ORDER only: an existing purchase request (created by the reviewer) that buys this line' })
  @IsOptional()
  @IsMongoId({ message: 'purchaseRequestId ບໍ່ຖືກຕ້ອງ' })
  purchaseRequestId?: string;

  @ApiPropertyOptional({ description: 'Note to the requester. Required for REJECT.' })
  @IsOptional()
  @IsString()
  note?: string;
}

export class ReviewSupplyLinesDto {
  @ApiProperty({ type: [ReviewSupplyLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReviewSupplyLineDto)
  lines!: ReviewSupplyLineDto[];
}
