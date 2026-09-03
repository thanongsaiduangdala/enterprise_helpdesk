import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTicketTypeDto {
    @ApiProperty({ example: 'VPN Access Issue' })
    @IsNotEmpty()
    name!: string;

    @ApiProperty({ example: 'DX001', description: 'A departments._id this type routes to by default' })
    @IsString()
    defaultDepartmentId!: string;

    @ApiPropertyOptional({ example: 'medium', enum: ['low', 'medium', 'high', 'urgent'] })
    @IsOptional()
    @IsIn(['low', 'medium', 'high', 'urgent'])
    defaultPriority?: string;

    @ApiPropertyOptional({ example: 'Issues connecting to the corporate VPN' })
    @IsOptional()
    @IsString()
    description?: string;

    @ApiPropertyOptional({ example: true })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}