import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TICKET_PRIORITIES } from '../schemas/ticket.schema';

export class CreateTicketDto {
    @ApiProperty({ example: "Laptop won't turn on" })
    @IsNotEmpty()
    @IsString()
    title!: string;

    @ApiProperty({ example: 'Tried charging overnight, still no power light.' })
    @IsNotEmpty()
    @IsString()
    description!: string;

    @ApiProperty({ example: 'TT001', description: 'A ticketTypes._id — drives auto-routing to a department' })
    @IsString()
    ticketTypeId!: string;

    @ApiProperty({ example: 'BX001' })
    @IsString()
    branchId!: string;

    @ApiPropertyOptional({ example: 'DX001', description: "Overrides the ticket type's default department if provided" })
    @IsOptional()
    @IsString()
    departmentId?: string;

    @ApiPropertyOptional({ example: 'high', enum: TICKET_PRIORITIES, description: "Overrides the ticket type's default priority if provided" })
    @IsOptional()
    @IsIn(TICKET_PRIORITIES)
    priority?: string;

    // raisedBy is intentionally NOT here — taken from the authenticated user, same
    // pattern as announcements/supply requests: never trust who's "raising" this from
    // the request body.
}
