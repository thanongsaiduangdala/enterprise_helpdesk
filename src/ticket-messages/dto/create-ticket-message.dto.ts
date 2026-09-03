import { IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTicketMessageDto {
    @ApiProperty({ example: 'TT001', description: 'Format not finalized yet — Tickets module not built' })
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

    // senderId is intentionally NOT here — taken from the authenticated user.
}
