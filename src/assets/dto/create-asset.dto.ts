import { IsDateString, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAssetDto {
    @ApiProperty({ example: 'A-1042' })
    @IsNotEmpty()
    @IsString()
    assetTag!: string;

    @ApiProperty({ example: 'Laptop' })
    @IsNotEmpty()
    @IsString()
    type!: string;

    @ApiProperty({ example: 'BX001' })
    @IsString()
    @Matches(/^BX\d{3}$/, { message: 'branchId must look like BX001' })
    branchId!: string;

    @ApiPropertyOptional({ example: '2026-01-15' })
    @IsOptional()
    @IsDateString()
    purchaseDate?: string;

    @ApiPropertyOptional({ example: '2029-01-15' })
    @IsOptional()
    @IsDateString()
    warrantyExpiry?: string;

    // status and currentAssigneeId are intentionally NOT here — a new asset always
    // starts AVAILABLE with no assignee. Use the /assign endpoint to assign it.
}
