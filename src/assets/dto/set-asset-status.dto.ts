import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetAssetStatusDto {



    @ApiProperty({ example: 'UNDER_REPAIR', enum: ['AVAILABLE', 'UNDER_REPAIR', 'RETIRED'] })
    @IsIn(['AVAILABLE', 'UNDER_REPAIR', 'RETIRED'])
    status!: 'AVAILABLE' | 'UNDER_REPAIR' | 'RETIRED';
}
