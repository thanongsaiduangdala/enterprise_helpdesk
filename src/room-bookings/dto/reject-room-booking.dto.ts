import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RejectRoomBookingDto {
    @ApiProperty({ example: 'ຫ້ອງຖືກຈອງໄວ້ແລ້ວສຳລັບກອງປະຊຸມອື່ນ' })
    @IsString()
    @MinLength(3, { message: 'ກະລຸນາລະບຸເຫດຜົນການປະຕິເສດ' })
    reason!: string;
}
