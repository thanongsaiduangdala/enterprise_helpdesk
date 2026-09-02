import {
    IsArray,
    IsBoolean,
    IsIn,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RoomStatus } from '../schemas/room.schema';

export class CreateRoomDto {
    @ApiProperty({ example: 'BX001' })
    @IsNotEmpty()
    @IsString()
    branchId!: string;

    @ApiProperty({ example: 'Conference Room A' })
    @IsNotEmpty()
    @IsString()
    name!: string;

    @ApiPropertyOptional({ example: '3rd Floor, East Wing' })
    @IsOptional()
    @IsString()
    location?: string;

    @ApiProperty({ example: 8 })
    @IsInt()
    @Min(1)
    capacity!: number;

    @ApiPropertyOptional({ example: ['projector', 'whiteboard', 'video conf'] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    amenities?: string[];

    @ApiPropertyOptional({ enum: RoomStatus, example: RoomStatus.AVAILABLE })
    @IsOptional()
    @IsIn(Object.values(RoomStatus))
    status?: RoomStatus;

    @ApiPropertyOptional({ example: true })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}
