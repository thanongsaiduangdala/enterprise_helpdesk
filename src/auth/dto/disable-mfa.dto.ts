import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DisableMfaDto {
  @ApiProperty({
    enum: ['totp', 'email', 'pin'],
    description: 'The MFA method to turn off',
  })
  @IsIn(['totp', 'email', 'pin'])
  method!: 'totp' | 'email' | 'pin';

  @ApiPropertyOptional({
    enum: ['totp', 'email', 'pin'],
    description: 'Enabled method used to prove it is you',
  })
  @IsOptional()
  @IsIn(['totp', 'email', 'pin'])
  verifyMethod?: 'totp' | 'email' | 'pin';

  @ApiPropertyOptional({
    example: '123456',
    description: 'Code / PIN for verifyMethod',
  })
  @IsOptional()
  @IsString()
  @Length(6, 8)
  verifyCode?: string;
}
