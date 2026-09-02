import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { RoomStatus } from '../schemas/room.schema';

export class SetRoomStatusDto {
    @ApiProperty({ enum: RoomStatus, example: RoomStatus.MAINTENANCE })
    @IsIn(Object.values(RoomStatus))
    status!: RoomStatus;
}