import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RequestChangesSupplyRequestDto {
  @ApiProperty({ example: 'Please be more specific about the computer spec' })
  @IsNotEmpty()
  @IsString()
  note!: string;
}
