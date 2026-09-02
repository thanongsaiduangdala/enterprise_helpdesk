import { IsInt } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AdjustStockDto {
    // Positive to add stock (e.g. restock), negative to deduct (e.g. manual correction).
    // Fulfilling a supply request deducts automatically — this endpoint is for manual admin adjustments.
    @ApiProperty({ example: -5, description: 'Positive to add stock, negative to deduct' })
    @IsInt()
    delta!: number;
}
