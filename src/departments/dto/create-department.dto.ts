import { IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDepartmentDto {
    @ApiProperty({ example: 'BX001', description: 'A branches._id' })
    @IsString()
    branchId!: string;

    @ApiProperty({ example: 'IT Support' })
    @IsNotEmpty()
    name!: string;

    @ApiPropertyOptional({ example: ['U010', 'U011'], description: 'users._id of department manager(s)' })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    managerIds?: string[];

    @ApiPropertyOptional({ example: true })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}