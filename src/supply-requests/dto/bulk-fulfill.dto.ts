import { ArrayMinSize, IsArray, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class BulkFulfillDto {
    @ApiProperty({ example: ['SR001', 'SR002'] })
    @IsArray()
    @ArrayMinSize(1)
    @IsString({ each: true })
    @Matches(/^SR\d{3}$/, { each: true, message: 'each id must look like SR001' })
    ids!: string[];
}