import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ReceiveSupplyRequestDto {
  @ApiPropertyOptional({
    example: ['SC002-001'],
    description:
      'Asset tags scanned from the equipment. Required for every item that is tracked as an asset (omit for consumables only)',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  assetTags?: string[];

  @ApiPropertyOptional({
    description:
      'Receiver confirms the consumable (non-tagged) items were received in full',
  })
  @IsOptional()
  @IsBoolean()
  confirmConsumables?: boolean;

  @ApiPropertyOptional({
    example: [0, 2],
    description:
      'Line-tracked requests only: indexes (in request.items) of the READY lines being collected now. Omit to collect every READY line. Ignored for legacy requests (they are received whole).',
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  lineIndexes?: number[];

  @ApiPropertyOptional({
    example: 'EMP001',
    description: 'Employee code of the receiver (defaults to the requester)',
  })
  @IsOptional()
  @IsString()
  assigneeCode?: string;

  @ApiPropertyOptional({
    example: 'Requester on leave, items needed for the audit today',
    description:
      'Required when storeroom staff confirm receipt but are not the requester, the named delegate or (for department requests) the custodian/manager. Needs the "assets.assign" permission; recorded in the audit log and the requester is notified.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  overrideReason?: string;
}
