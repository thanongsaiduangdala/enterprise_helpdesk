import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InviteMode } from '../schemas/room-booking.schema';

export class SetInviteModeDto {
  @ApiProperty({
    enum: [...Object.values(InviteMode), 'NONE'],
    example: 'PRIVATE',
  })
  @IsEnum({ ...InviteMode, NONE: 'NONE' })
  mode!: InviteMode | 'NONE';
}

export class AddInviteeDto {
  @ApiPropertyOptional({ example: 'Somchai V.' })
  @ValidateIf((o) => !o.userId && !o.accountId)
  @IsNotEmpty()
  @IsString()
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({
    description: 'User _id picked from the account search',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  userId?: string;

  @ApiPropertyOptional({
    example: 'EMP001',
    description: 'Account ID (employee code)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  accountId?: string;

  @ApiPropertyOptional({ example: 'somchai@example.com' })
  @IsOptional()
  @IsEmail()
  @MaxLength(120)
  email?: string;

  @ApiPropertyOptional({ example: '020 5555 1234' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}

export class BulkInviteDto {
  @ApiProperty({
    type: [String],
    description: 'User _ids picked from the filtered account list (max 300)',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(300)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  userIds!: string[];
}

export class BulkRemoveInviteesDto {
  @ApiProperty({
    type: [String],
    description: 'Invitee _ids on the guest list to remove (max 300)',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(300)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  inviteeIds!: string[];
}

export class SelectedQrPdfDto {
  @ApiProperty({
    type: [String],
    description: 'Invitee _ids to print passes for (max 300)',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(300)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  inviteeIds!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  baseUrl?: string;
}

export class JoinDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  contact?: string;
}
