import {
    ArrayNotEmpty,
    IsArray,
    IsBoolean,
    IsIn,
    IsNotEmpty,
    IsOptional,
    IsString,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class LocationDto {
    @ApiProperty({ example: 'Lane Xang Avenue, Ban Haisok' })
    @IsString()
    address!: string;

    @ApiProperty({ example: 'Vientiane' })
    @IsString()
    city!: string;

    @ApiProperty({ example: 'Laos' })
    @IsString()
    country!: string;

    @ApiProperty({ example: 'Asia/Vientiane' })
    @IsString()
    timezone!: string;
}

class DayHoursDto {
    @ApiProperty({ example: 'mon', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] })
    @IsIn(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
    day!: string;

    @ApiPropertyOptional({ example: true })
    @IsOptional()
    @IsBoolean()
    isOpen?: boolean;

    @ApiPropertyOptional({ example: '09:00' })
    @IsOptional()
    @IsString()
    open?: string;

    @ApiPropertyOptional({ example: '18:00' })
    @IsOptional()
    @IsString()
    close?: string;
}

class HolidayDto {
    @ApiProperty({ example: '2026-04-14' })
    @IsString()
    date!: string;

    @ApiProperty({ example: 'Lao New Year (Pi Mai)' })
    @IsString()
    name!: string;
}

export class CreateBranchDto {
    @ApiProperty({ example: 'APB Head Office - Vientiane' })
    @IsNotEmpty()
    name!: string;

    @ApiProperty({ type: LocationDto })
    @ValidateNested()
    @Type(() => LocationDto)
    location!: LocationDto;

    @ApiPropertyOptional({ type: [DayHoursDto] })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => DayHoursDto)
    businessHours?: DayHoursDto[];

    @ApiPropertyOptional({ type: [HolidayDto] })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => HolidayDto)
    holidays?: HolidayDto[];

    @ApiPropertyOptional({ example: true })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}