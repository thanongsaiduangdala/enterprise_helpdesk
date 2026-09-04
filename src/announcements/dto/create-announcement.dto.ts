import { IsBoolean, IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnnouncementScope } from '../schemas/announcement.schema';

export class CreateAnnouncementDto {
    @ApiProperty({ example: 'Office closed for Pi Mai holiday' })
    @IsNotEmpty()
    @IsString()
    title!: string;

    @ApiProperty({ example: 'The Vientiane office will be closed April 14-16 for Lao New Year.' })
    @IsNotEmpty()
    @IsString()
    body!: string;

    @ApiProperty({ enum: AnnouncementScope, example: AnnouncementScope.BRANCH })
    @IsEnum(AnnouncementScope)
    scope!: AnnouncementScope;

    @ApiPropertyOptional({ example: 'BX001', description: 'Required when scope is BRANCH' })
    @ValidateIf((o) => o.scope === AnnouncementScope.BRANCH)
    @IsString()
    @Matches(/^BX\d{3}$/, { message: 'branchId must look like BX001' })
    branchId?: string;

    @ApiPropertyOptional({ example: 'DX001', description: 'Required when scope is DEPARTMENT' })
    @ValidateIf((o) => o.scope === AnnouncementScope.DEPARTMENT)
    @IsString()
    @Matches(/^DX\d{3}$/, { message: 'departmentId must look like DX001' })
    departmentId?: string;

    @ApiPropertyOptional({ example: '2026-09-10T00:00:00.000Z', description: 'Defaults to now if omitted' })
    @IsOptional()
    @IsDateString()
    publishAt?: string;

    @ApiPropertyOptional({ example: '2026-09-20T00:00:00.000Z' })
    @IsOptional()
    @IsDateString()
    expireAt?: string;

    @ApiPropertyOptional({ example: false })
    @IsOptional()
    @IsBoolean()
    pinned?: boolean;

    // createdBy is intentionally NOT here — taken from the authenticated user.
}
