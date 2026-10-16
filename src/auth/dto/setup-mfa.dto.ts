import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SetupMfaDto {
  @ApiProperty({
    enum: ['totp', 'email', 'pin'],
    example: 'totp',
    description: 'Which MFA method to set up',
  })
  @IsIn(['totp', 'email', 'pin'])
  method!: 'totp' | 'email' | 'pin';

  @ApiPropertyOptional({
    example: '482913',
    description: 'Your own PIN (6-8 digits). Required when method is "pin"',
  })
  @ValidateIf((o) => o.method === 'pin')
  @IsString()
  @Matches(/^\d{6,8}$/, { message: 'PIN must be 6-8 digits' })
  pin?: string;

  @ApiPropertyOptional({
    example: '482913',
    description: 'Repeat the PIN. Required when method is "pin"',
  })
  @ValidateIf((o) => o.method === 'pin')
  @IsString()
  confirmPin?: string;

  @ApiPropertyOptional({
    enum: ['totp', 'email', 'pin'],
    description:
      'Already-enabled method used to prove it is you. Required when other MFA methods are already enabled',
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
