import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SelectMfaMethodDto {
    @ApiProperty({ description: 'The mfaToken returned from POST /auth/login when MFA is required' })
    @IsNotEmpty()
    @IsString()
    mfaToken!: string;

    @ApiProperty({ enum: ['totp', 'email', 'pin'], description: 'Which of the enabled MFA methods to use for this login' })
    @IsIn(['totp', 'email', 'pin'])
    method!: 'totp' | 'email' | 'pin';
}
