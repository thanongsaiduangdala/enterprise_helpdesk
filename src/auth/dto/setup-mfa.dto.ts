import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetupMfaDto {
    @ApiProperty({ enum: ['totp', 'email'], example: 'totp', description: 'Which MFA method to set up' })
    @IsIn(['totp', 'email'])
    method!: 'totp' | 'email';
}
