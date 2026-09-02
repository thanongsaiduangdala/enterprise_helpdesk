import { IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, Matches, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class RecurrenceDto {
    @ApiProperty({ example: 'weekly', enum: ['daily', 'weekly'] })
    @IsIn(['daily', 'weekly'])
    frequency!: string;

    @ApiProperty({ example: '2026-12-31' })
    @IsDateString()
    until!: string;
}

export class CreateRoomBookingDto {
    @ApiProperty({ example: 'R001' })
    @IsNotEmpty()
    @IsString()
    @Matches(/^R\d{3}$/, { message: 'roomId must look like R001' })
    roomId!: string;

    @ApiProperty({ example: '2026-09-05T09:00:00.000Z' })
    @IsDateString()
    startAt!: string;

    @ApiProperty({ example: '2026-09-05T10:00:00.000Z' })
    @IsDateString()
    endAt!: string;

    @ApiPropertyOptional({ type: RecurrenceDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => RecurrenceDto)
    recurrence?: RecurrenceDto;

}