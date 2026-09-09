import { IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTicketMessageDto {
    @ApiProperty({ example: '665fbb1f2c1a4e3b9c8d0a11', description: "A ticket's _id — must reference an existing ticket" })
    @IsNotEmpty()
    @IsString()
    ticketId!: string;

    @ApiProperty({ example: 'Thanks for reaching out — could you confirm your device OS?' })
    @IsNotEmpty()
    @IsString()
    body!: string;

    @ApiPropertyOptional({ example: ['https://s3.example.com/attachments/screenshot.png'] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    attachments?: string[];

    @ApiPropertyOptional({ example: false })
    @IsOptional()
    @IsBoolean()
    isCannedResponse?: boolean;

    @ApiPropertyOptional({ example: 'CR001', description: 'Required if isCannedResponse is true' })
    @IsOptional()
    @IsString()
    @Matches(/^CR\d{3}$/, { message: 'cannedResponseId must look like CR001' })
    cannedResponseId?: string;
}