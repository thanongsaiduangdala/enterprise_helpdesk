import { IsMongoId, IsOptional, IsString, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AssignDepartmentDto {
  @ApiProperty({
    example: 'DX001',
    description: 'A departments._id (DX###) to assign this asset to',
  })
  @Matches(/^DX\d{3}$/, { message: 'departmentId must look like DX001' })
  departmentId!: string;

  @ApiProperty({
    example: '665fbb1f2c1a4e3b9c8d0a12',
    description: 'A users._id of the custodian responsible for the asset',
  })
  @IsMongoId()
  custodianId!: string;

  @ApiPropertyOptional({
    example: '665fbb1f2c1a4e3b9c8d0a13',
    description: 'A users._id of the person who actually received the asset',
  })
  @IsOptional()
  @IsMongoId()
  receivedById?: string;

  @ApiPropertyOptional({ example: 'Assigned to the IT department' })
  @IsOptional()
  @IsString()
  note?: string;
}
