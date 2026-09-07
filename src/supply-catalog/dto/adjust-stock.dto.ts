import { IsInt } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AdjustStockDto {


    @ApiProperty({ example: -5, description: 'Positive to add stock, negative to deduct' })
    @IsInt()
    delta!: number;
}
