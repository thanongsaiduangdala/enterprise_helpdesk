import { IsMongoId, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AssignAssetDto {
    @ApiProperty({ example: '665fbb1f2c1a4e3b9c8d0a11', description: 'A users._id to assign this asset to' })
    @IsMongoId()
    assigneeId!: string;

    @ApiPropertyOptional({ example: 'Replacement for damaged unit' })
    @IsOptional()
    @IsString()
    note?: string;
}
