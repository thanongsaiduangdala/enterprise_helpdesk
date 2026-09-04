import { IsMongoId, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AssignTicketDto {
    @ApiProperty({ example: '665fbb1f2c1a4e3b9c8d0a11', description: 'A users._id to assign/reassign this ticket to' })
    @IsMongoId()
    agentId!: string;

    @ApiPropertyOptional({ example: 'Reassigning — original agent is on leave' })
    @IsOptional()
    @IsString()
    note?: string;
}
