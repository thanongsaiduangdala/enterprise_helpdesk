import { IsNotEmpty, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MfaCodeDto {
  @ApiProperty({
    example: '123456',
    description:
      '6-digit code from the authenticator app, the code emailed to you, or your 6-8 digit PIN',
  })
  @IsNotEmpty()
  @IsString()
  @Length(6, 8)
  code!: string;
}
