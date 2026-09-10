import { IsNotEmpty, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MfaVerifyLoginDto {
    @ApiProperty({ description: 'The mfaToken returned from POST /auth/login when MFA is required' })
    @IsNotEmpty()
    @IsString()
    mfaToken!: string;

    @ApiProperty({ example: '123456', description: '6-digit code from the authenticator app, or the code emailed to you' })
    @IsNotEmpty()
    @IsString()
    @Length(6, 6)
    code!: string;
}
