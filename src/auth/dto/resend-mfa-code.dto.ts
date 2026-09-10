import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResendMfaCodeDto {
    @ApiProperty({ description: 'The mfaToken returned from POST /auth/login when MFA is required' })
    @IsNotEmpty()
    @IsString()
    mfaToken!: string;
}
