import { ArrayMaxSize, IsArray, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateKbArticleDto {
    @ApiProperty({ example: 'How to reset your VPN client' })
    @IsNotEmpty()
    @IsString()
    title!: string;

    @ApiProperty({ example: 'Step 1: Open the VPN client... Step 2: ...' })
    @IsNotEmpty()
    @IsString()
    body!: string;

    @ApiProperty({ example: 'Networking' })
    @IsNotEmpty()
    @IsString()
    category!: string;

    @ApiProperty({ example: 'DX001' })
    @IsString()
    @Matches(/^DX\d{3}$/, { message: 'departmentId must look like DX001' })
    departmentId!: string;

    @ApiPropertyOptional({ example: ['vpn', 'network', 'connection'] })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(15)
    @IsString({ each: true })
    tags?: string[];

    // status and authorId are intentionally NOT here — every new article starts DRAFT,
    // and authorId is taken from the authenticated user, not trusted from the request body.
}
