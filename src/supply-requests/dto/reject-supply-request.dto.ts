import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RejectSupplyRequestDto {
    @ApiProperty({ example: 'Over quarterly budget for this item — resubmit next quarter' })
    @IsNotEmpty()
    @IsString()
    reason!: string;
}
