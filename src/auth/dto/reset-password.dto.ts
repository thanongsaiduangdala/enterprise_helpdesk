import { IsEmail, IsOptional, IsString, Length, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ResetPasswordDto {
    @ApiProperty({ example: 'jane@example.com' })
    @IsEmail()
    email!: string;

    @ApiProperty({ example: '123456', description: '6-digit code emailed to the user' })
    @IsString()
    @Length(6, 6)
    code!: string;

    @ApiPropertyOptional({ example: '654321', description: 'Authenticator-app code, required only if the account uses an authenticator app for MFA' })
    @IsOptional()
    @IsString()
    @Length(6, 6)
    mfaCode?: string;

    @ApiProperty({ minLength: 8 })
    @IsString()
    @MinLength(8)
    newPassword!: string;
}
