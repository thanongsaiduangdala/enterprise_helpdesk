import {
  IsDateString,
  IsEnum,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { MaintenanceStatus } from '../schemas/maintenance-history.schema';

export class UpdateMaintenanceRecordDto {
  @ApiPropertyOptional({ example: '2026-10-02T15:00:00Z' })
  @IsOptional()
  @IsDateString()
  completionDate?: string;

  @ApiPropertyOptional({ enum: MaintenanceStatus })
  @IsOptional()
  @IsEnum(MaintenanceStatus)
  status?: MaintenanceStatus;

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
