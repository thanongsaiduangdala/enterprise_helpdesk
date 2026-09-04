import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ReturnAssetDto {
    @ApiPropertyOptional({ example: 'Returned on offboarding, good condition' })
    @IsOptional()
    @IsString()
    note?: string;
}
