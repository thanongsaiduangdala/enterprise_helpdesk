import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCannedResponseDto {
    @ApiProperty({ example: 'DX001' })
    @IsString()
    @Matches(/^DX\d{3}$/, { message: 'departmentId must look like DX001' })
    departmentId!: string;

    @ApiProperty({ example: 'VPN reset instructions' })
    @IsNotEmpty()
    @IsString()
    title!: string;

    @ApiProperty({ example: 'Please try resetting your VPN client and reconnecting. If the issue persists...' })
    @IsNotEmpty()
    @IsString()
    body!: string;



}
