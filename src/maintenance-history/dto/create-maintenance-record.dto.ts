import {
  IsDateString,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MaintenanceStatus } from '../schemas/maintenance-history.schema';

export class CreateMaintenanceRecordDto {
  @ApiProperty({
    example: 'AS001',
    description: 'Asset _id — ເປັນ string ທີ່ສ້າງເອງ (AS001) ບໍ່ແມ່ນ ObjectId',
  })
  @IsString()
  @IsNotEmpty()
  assetId!: string;

  @ApiPropertyOptional({ example: '2026-10-02T10:00:00Z' })
  @IsOptional()
  @IsDateString()
  maintenanceDate?: string;

  @ApiPropertyOptional({
    enum: MaintenanceStatus,
    default: MaintenanceStatus.IN_PROGRESS,
  })
  @IsOptional()
  @IsEnum(MaintenanceStatus)
  status?: MaintenanceStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  previousStatus?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  newStatus?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  issue?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  repairNotes?: string;

  @ApiPropertyOptional({ example: '665fbb1f2c1a4e3b9c8d0a22' })
  @IsOptional()
  @IsMongoId()
  technicianId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  cost?: number;
}
