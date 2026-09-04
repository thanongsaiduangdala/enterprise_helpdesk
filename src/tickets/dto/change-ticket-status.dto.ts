import { IsIn, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TicketStatus } from '../schemas/ticket.schema';

export class ChangeTicketStatusDto {
    @ApiProperty({ enum: TicketStatus, example: TicketStatus.IN_PROGRESS })
    @IsIn(Object.values(TicketStatus))
    status!: TicketStatus;

    @ApiPropertyOptional({ example: 'Waiting on user to confirm the fix worked' })
    @IsOptional()
    @IsString()
    note?: string;
}
