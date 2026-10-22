import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PoprAssetStatus,
  PoprCondition,
  PoprDeliveryStatus,
  PoprItemType,
  PoprOrderStatus,
  PoprStatus,
} from '../schemas/popr-record.schema';

/** P — ການຈັດຫາ/ຈັດຊື້ */
export class ProcurementDto {
  @ApiPropertyOptional({
    example: 'SC002',
    description: 'Omit for a free-text item not yet in the catalog',
  })
  @IsOptional()
  @IsString()
  @Matches(/^SC\d{3}$/, { message: 'catalogItemId must look like SC002' })
  catalogItemId?: string;

  @ApiPropertyOptional({ example: 'Dell Latitude 5450' })
  @IsOptional()
  @IsString()
  itemName?: string;

  @ApiPropertyOptional({
    example: '2026-11-01',
    description: 'Expected delivery date for the PO (one of the 5 PO fields)',
  })
  @IsOptional()
  @IsDateString()
  expectedDeliveryDate?: string;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional({
    example: 'Computer',
    description:
      'Category used to auto-create the catalog item on close if it is missing',
  })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({
    example: 'pcs',
    description: 'Unit used when auto-creating the catalog item',
  })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional({
    example: 5,
    description: 'Low-stock threshold for the auto-created catalog item',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  lowStockThreshold?: number;

  @ApiPropertyOptional({ example: 'CPU i5, RAM 16GB, SSD 512GB' })
  @IsOptional()
  @IsString()
  spec?: string;

  @ApiPropertyOptional({ example: 12000000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  budget?: number;

  @ApiPropertyOptional({
    example: 11500000,
    description: 'Purchase price per 1 unit',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({
    example: 50,
    description: 'Total quantity ordered on the whole PO (all lots)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  poTotalQuantity?: number;

  @ApiPropertyOptional({
    example: 1,
    description: 'Lot (delivery) number of this PO',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  lotNo?: number;

  @ApiPropertyOptional({ example: 'IT Solutions Co., Ltd' })
  @IsOptional()
  @IsString()
  vendor?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  vendorStandard?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  warrantyAgreement?: boolean;

  @ApiPropertyOptional({ example: 'PO-2026-0001' })
  @IsOptional()
  @IsString()
  poNumber?: string;

  @ApiPropertyOptional({ example: 'GRN-0001' })
  @IsOptional()
  @IsString()
  goodsReceiptNo?: string;

  @ApiPropertyOptional({ example: 'Somchai S.' })
  @IsOptional()
  @IsString()
  orderedBy?: string;

  @ApiPropertyOptional({
    example: '65f1a2b3c4d5e6f708192a3b',
    description:
      'User._id of who placed the order (defaults to the record creator)',
  })
  @IsOptional()
  @IsMongoId()
  orderedByUserId?: string;

  @ApiPropertyOptional({
    enum: PoprOrderStatus,
    example: PoprOrderStatus.PENDING,
    description: 'PENDING → PROCESS',
  })
  @IsOptional()
  @IsEnum(PoprOrderStatus)
  orderStatus?: PoprOrderStatus;
}

/** ຕໍ່ໜ່ວຍທີ່ຮັບເຂົ້າ: S/N ຂອງໜ່ວຍ ຫຼື ຜູກຊັບສິນເດີມ (ບໍ່ສ້າງຊ້ຳ) */
export class ReceivingUnitDto {
  @ApiPropertyOptional({ example: 'SN-8FJ2K9' })
  @IsOptional()
  @IsString()
  serialNumber?: string;

  @ApiPropertyOptional({
    example: 'AS001',
    description: 'Existing asset to link instead of creating a new one',
  })
  @IsOptional()
  @IsString()
  assetId?: string;
}

/** O — ການຮັບເຂົ້າ/ຕ້ອນຮັບ */
export class ReceivingDto {
  @ApiPropertyOptional({ example: '2026-10-15' })
  @IsOptional()
  @IsDateString()
  receivedDate?: string;

  @ApiPropertyOptional({ enum: PoprCondition, example: PoprCondition.GOOD })
  @IsOptional()
  @IsEnum(PoprCondition)
  boxCondition?: PoprCondition;

  @ApiPropertyOptional({ enum: PoprCondition, example: PoprCondition.GOOD })
  @IsOptional()
  @IsEnum(PoprCondition)
  equipmentCondition?: PoprCondition;

  @ApiPropertyOptional({
    example: 'SN-8FJ2K9',
    description: 'Legacy single-unit S/N — prefer `units`',
  })
  @IsOptional()
  @IsString()
  serialNumber?: string;

  @ApiPropertyOptional({
    type: [ReceivingUnitDto],
    description:
      'Per-unit S/N or link to an existing asset. ELECTRONIC needs one entry per purchased unit.',
  })
  @IsOptional()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ReceivingUnitDto)
  units?: ReceivingUnitDto[];

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  snMatch?: boolean;

  @ApiPropertyOptional({
    example: 100,
    description:
      'Received quantity for CONSUMABLE items (added to catalog stock on close)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  receivedQuantity?: number;

  @ApiPropertyOptional({ example: 'SC002-001' })
  @IsOptional()
  @IsString()
  assetTag?: string;

  @ApiPropertyOptional({
    example: 'AS001',
    description:
      'Asset._id from the asset registry (links POPR to a real asset)',
  })
  @IsOptional()
  @IsString()
  assetId?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  assetRegistered?: boolean;

  @ApiPropertyOptional({ example: 'Somchai IT' })
  @IsOptional()
  @IsString()
  receivedBy?: string;

  @ApiPropertyOptional({
    example: '65f1a2b3c4d5e6f708192a3b',
    description: 'User._id of the operator who received the item',
  })
  @IsOptional()
  @IsMongoId()
  receivedByUserId?: string;

  @ApiPropertyOptional({ example: 'IT Department' })
  @IsOptional()
  @IsString()
  custodian?: string;

  @ApiPropertyOptional({ example: 'HQ / Room 302' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({
    enum: PoprDeliveryStatus,
    example: PoprDeliveryStatus.SHIPPING,
    description: 'SHIPPING → REVIEW → RECEIVED',
  })
  @IsOptional()
  @IsEnum(PoprDeliveryStatus)
  deliveryStatus?: PoprDeliveryStatus;
}

/** P — ການຕຽມ/ກຳນົດຄ່າ */
export class PreparationDto {
  @ApiPropertyOptional({ example: 'Windows 11 Pro' })
  @IsOptional()
  @IsString()
  os?: string;

  @ApiPropertyOptional({ example: 'MS Office, VPN Client' })
  @IsOptional()
  @IsString()
  software?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  secAntivirus?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  secEdr?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  secFirewall?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  domainJoined?: boolean;

  @ApiPropertyOptional({ example: 'somchai.it' })
  @IsOptional()
  @IsString()
  userAccount?: string;

  @ApiPropertyOptional({ example: 'VLAN-10 / WIFI-OFFICE' })
  @IsOptional()
  @IsString()
  network?: string;

  @ApiPropertyOptional({ example: 'Shared Drive, ERP' })
  @IsOptional()
  @IsString()
  accessRights?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  diskEncryption?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  securityPolicy?: boolean;
}

/** R — ການປ່ອຍ/ລົງທະບຽນ */
export class ReleaseDto {
  @ApiPropertyOptional({ example: 'Finance Department' })
  @IsOptional()
  @IsString()
  deliveredTo?: string;

  @ApiPropertyOptional({
    example: '65f1a2b3c4d5e6f708192a3b',
    description: 'User._id of the recipient when delivered to a person',
  })
  @IsOptional()
  @IsMongoId()
  deliveredToUserId?: string;

  @ApiPropertyOptional({ example: 'Somchai S.' })
  @IsOptional()
  @IsString()
  assignedUser?: string;

  @ApiPropertyOptional({
    example: '65f1a2b3c4d5e6f708192a3b',
    description: 'User._id of the user the equipment was assigned to',
  })
  @IsOptional()
  @IsMongoId()
  assignedUserId?: string;

  @ApiPropertyOptional({ example: '2026-10-20' })
  @IsOptional()
  @IsDateString()
  deliveryDate?: string;

  @ApiPropertyOptional({
    enum: PoprAssetStatus,
    example: PoprAssetStatus.IN_USE,
  })
  @IsOptional()
  @IsEnum(PoprAssetStatus)
  assetStatus?: PoprAssetStatus;

  @ApiPropertyOptional({
    example: false,
    description:
      'true = store the assets in stock (AVAILABLE) instead of assigning them to a user',
  })
  @IsOptional()
  @IsBoolean()
  storeInStock?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  signedHandover?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  userOrientation?: boolean;
}

export class CreatePoprRecordDto {
  @ApiPropertyOptional({
    enum: PoprStatus,
    example: PoprStatus.IN_PROGRESS,
    description: 'Defaults to DRAFT',
  })
  @IsOptional()
  @IsEnum(PoprStatus)
  status?: PoprStatus;

  @ApiPropertyOptional({
    enum: PoprItemType,
    example: PoprItemType.ELECTRONIC,
    description: 'GENERAL skips serial number, OS and security requirements',
  })
  @IsOptional()
  @IsEnum(PoprItemType)
  itemType?: PoprItemType;

  @ApiPropertyOptional({
    example: 2,
    minimum: 1,
    maximum: 4,
    description: 'Phase reached so far',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  stage?: number;

  @ApiProperty({
    example: 'SR001',
    description:
      'SupplyRequest this record originates from (one record per SR item line). Required — POPR ຕ້ອງມາຈາກໃບຂໍຊື້.',
  })
  @IsString()
  @Matches(/^SR\d{3,}$/, { message: 'supplyRequestId must look like SR001' })
  supplyRequestId!: string;

  @ApiPropertyOptional({
    example: 0,
    description: 'Index of the item line within the SupplyRequest',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  supplyRequestItemIndex?: number;

  @ApiPropertyOptional({ type: ProcurementDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProcurementDto)
  procurement?: ProcurementDto;

  @ApiPropertyOptional({ type: ReceivingDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ReceivingDto)
  receiving?: ReceivingDto;

  @ApiPropertyOptional({ type: PreparationDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PreparationDto)
  preparation?: PreparationDto;

  @ApiPropertyOptional({ type: ReleaseDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ReleaseDto)
  release?: ReleaseDto;
}
