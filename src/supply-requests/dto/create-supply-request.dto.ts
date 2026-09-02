import {
    ArrayMinSize,
    IsArray,
    IsInt,
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
    @ApiPropertyOptional({ example: 'SC001', description: 'Omit for a free-text "other" item not in the catalog' })
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

    // requestedBy is intentionally NOT here — taken from the authenticated user, same
    // reasoning as room bookings: never trust who's "requesting" from the request body.
}
