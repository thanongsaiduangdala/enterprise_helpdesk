import { IsDateString, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAssetDto {
    @ApiPropertyOptional({
        example: 'A-1042',
        description: 'Leave empty to auto-generate from a catalog item, e.g. SC002-001',
    })
    @IsOptional()
    @IsString()
    assetTag?: string;

    @ApiProperty({ example: 'Laptop' })
    @IsNotEmpty()
    @IsString()
    type!: string;

    @ApiPropertyOptional({ example: 'SC002', description: 'Supply catalog item this asset belongs to' })
    @IsOptional()
    @IsString()
    catalogItemId?: string;

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



}
