import { IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RescheduleRoomBookingDto {
    @ApiProperty({ example: '2026-09-05T11:00:00.000Z' })
    @IsDateString()
    startAt!: string;

    @ApiProperty({ example: '2026-09-05T12:00:00.000Z' })
    @IsDateString()
    endAt!: string;
}
