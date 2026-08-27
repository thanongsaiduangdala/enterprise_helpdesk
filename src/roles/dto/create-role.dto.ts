import { Type } from 'class-transformer';
import {
    ArrayNotEmpty,
    IsArray,
    IsBoolean,
    IsOptional,
    IsString,
    ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class PermissionDto {
    @ApiProperty({ example: 'tickets' })
    @IsString()
    module!: string;

    @ApiProperty({ example: ['read', 'update', 'assign'] })
    @IsArray()
    @ArrayNotEmpty()
    @IsString({ each: true })
    actions!: string[];
}

export class CreateRoleDto {
    @ApiProperty({ example: 'REGIONAL_COORDINATOR' })
    @IsString()
    name!: string;

    @ApiPropertyOptional({ type: [PermissionDto] })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => PermissionDto)
    permissions?: PermissionDto[];

    @ApiPropertyOptional({ example: false })
    @IsOptional()
    @IsBoolean()
    mfaRequired?: boolean;

}
