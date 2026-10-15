import { IsIn, IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MfaVerifyLoginDto {
    @ApiProperty({ description: 'The mfaToken returned from POST /auth/login when MFA is required' })
    @IsNotEmpty()
    @IsString()
    mfaToken!: string;

    @ApiProperty({ example: '123456', description: '6-digit code from the authenticator app, the code emailed to you, or your 6-8 digit PIN' })
    @IsNotEmpty()
    @IsString()
    @Length(6, 8)
    code!: string;

    @ApiPropertyOptional({ enum: ['totp', 'email', 'pin'], description: 'Which enabled method the code is for. Optional only when the account has exactly one method enabled' })
    @IsOptional()
    @IsIn(['totp', 'email', 'pin'])
    method?: 'totp' | 'email' | 'pin';
}
