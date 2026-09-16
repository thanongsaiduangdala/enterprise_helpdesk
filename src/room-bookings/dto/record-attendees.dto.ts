import { ArrayMaxSize, IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RecordAttendeesDto {
    @ApiProperty({ example: ['Somchai V.', 'Jane Doe', 'ແຂກ: ທ້າວ ບຸນມີ'] })
    @IsArray()
    @ArrayMaxSize(200)
    @IsString({ each: true })
    attendees!: string[];
}
