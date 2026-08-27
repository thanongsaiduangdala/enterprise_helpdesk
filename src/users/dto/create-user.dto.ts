import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserDto {
    @ApiProperty({ example: 'USR001' })
    @IsNotEmpty()
    employeeCode!: string;

    @ApiProperty({ example: 'Jane' })
    @IsNotEmpty()
    firstName!: string;

    @ApiProperty({ example: 'Doe' })
    @IsNotEmpty()
    lastName!: string;

    @ApiProperty({ example: 'jane@example.com' })
    @IsEmail()
    email!: string;

    @ApiProperty({ example: 'password123', minLength: 8 })
    @MinLength(8)
    password!: string;

    @ApiPropertyOptional({ example: '+856 20 000 000 00' })
    @IsOptional()
    phone?: string;

    @ApiProperty({ example: 'R001', description: 'A roles._id' })
    @IsString()
    role!: string;

    @ApiProperty({ example: 'BX001' })
    @IsNotEmpty()
    branchId!: string;

    @ApiPropertyOptional({ example: 'DX001' })
    @IsOptional()
    departmentId?: string;
}