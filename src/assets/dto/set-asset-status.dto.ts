import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetAssetStatusDto {
    // ASSIGNED is deliberately excluded — an asset can only become ASSIGNED via the
    // /assign endpoint, which also records who it's assigned to. This endpoint is for
    // the other three states an admin sets directly.
    @ApiProperty({ example: 'UNDER_REPAIR', enum: ['AVAILABLE', 'UNDER_REPAIR', 'RETIRED'] })
    @IsIn(['AVAILABLE', 'UNDER_REPAIR', 'RETIRED'])
    status!: 'AVAILABLE' | 'UNDER_REPAIR' | 'RETIRED';
}
