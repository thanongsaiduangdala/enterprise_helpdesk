import { ArrayMinSize, IsArray, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReceiveSupplyRequestDto {
    @ApiProperty({ example: ['AS001'], description: 'Asset tags scanned from the equipment at the warehouse' })
    @IsArray()
    @ArrayMinSize(1)
    @IsString({ each: true })
    assetTags!: string[];

    @ApiPropertyOptional({ example: 'EMP001', description: 'Employee code of the receiver (defaults to the acting user)' })
    @IsOptional()
    @IsString()
    assigneeCode?: string;
}