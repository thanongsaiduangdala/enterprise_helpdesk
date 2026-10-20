import { IsDateString, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const BOOKING_CHANGE_TYPES = ['TIME', 'ROOM', 'EITHER'] as const;
export type BookingChangeType = (typeof BOOKING_CHANGE_TYPES)[number];

export class RequestBookingChangeDto {
  @ApiProperty({
    enum: BOOKING_CHANGE_TYPES,
    example: 'EITHER',
    description:
      'TIME = ask requester to change the time, ROOM = ask to move to another room, EITHER = let them choose',
  })
  @IsIn(BOOKING_CHANGE_TYPES as unknown as string[])
  type!: BookingChangeType;

  @ApiProperty({ example: 'ເວລາຊົ່ວກັບການຈອງອື່ນ ກະລຸນາເລື່ອນເວລາ ຫຼື ປ່ຽນຫ້ອງ' })
  @IsString()
  @MinLength(3)
  message!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({
    description:
      'Room the approver recommends the requester move to (shown as "Recommended" in the requester\'s room list)',
  })
  @IsOptional()
  @IsString()
  suggestedRoomId?: string;

  @ApiPropertyOptional({
    description:
      'Suggested new start time (ISO). Must be sent together with suggestedEndAt; the duration must equal the requested duration',
  })
  @IsOptional()
  @IsDateString()
  suggestedStartAt?: string;

  @ApiPropertyOptional({ description: 'Suggested new end time (ISO)' })
  @IsOptional()
  @IsDateString()
  suggestedEndAt?: string;
}
