import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class StepUpSendCodeDto {
    @ApiProperty({ enum: ['totp', 'email', 'pin'], description: 'The MFA method you are about to add / change / turn off' })
    @IsIn(['totp', 'email', 'pin'])
    target!: 'totp' | 'email' | 'pin';
}
