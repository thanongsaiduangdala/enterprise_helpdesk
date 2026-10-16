import { Type } from 'class-transformer';
import {
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
import { ApiPropertyOptional } from '@nestjs/swagger';
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
    @ApiPropertyOptional({ example: 'SC002', description: 'Omit for a free-text item not yet in the catalog' })
    @IsOptional()
    @IsString()
    @Matches(/^SC\d{3}$/, { message: 'catalogItemId must look like SC002' })
    catalogItemId?: string;

    @ApiPropertyOptional({ example: 'Dell Latitude 5450' })
    @IsOptional()
    @IsString()
    itemName?: string;

    @ApiPropertyOptional({ example: 5 })
    @IsOptional()
    @IsInt()
    @Min(1)
    quantity?: number;

    @ApiPropertyOptional({ example: 'CPU i5, RAM 16GB, SSD 512GB' })
    @IsOptional()
    @IsString()
    spec?: string;

    @ApiPropertyOptional({ example: 12000000 })
    @IsOptional()
    @IsNumber()
    @Min(0)
    budget?: number;

    @ApiPropertyOptional({ example: 11500000 })
    @IsOptional()
    @IsNumber()
    @Min(0)
    price?: number;

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

    @ApiPropertyOptional({ enum: PoprOrderStatus, example: PoprOrderStatus.PENDING, description: 'PENDING → PROCESS' })
    @IsOptional()
    @IsEnum(PoprOrderStatus)
    orderStatus?: PoprOrderStatus;
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

    @ApiPropertyOptional({ example: 'SN-8FJ2K9' })
    @IsOptional()
    @IsString()
    serialNumber?: string;

    @ApiPropertyOptional({ example: true })
    @IsOptional()
    @IsBoolean()
    snMatch?: boolean;

    @ApiPropertyOptional({ example: 'SC002-001' })
    @IsOptional()
    @IsString()
    assetTag?: string;

    @ApiPropertyOptional({ example: 'AS001', description: 'Asset._id from the asset registry (links POPR to a real asset)' })
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

    @ApiPropertyOptional({ example: '65f1a2b3c4d5e6f708192a3b', description: 'User._id of the operator who received the item' })
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

    @ApiPropertyOptional({ enum: PoprDeliveryStatus, example: PoprDeliveryStatus.SHIPPING, description: 'SHIPPING → REVIEW → RECEIVED' })
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

    @ApiPropertyOptional({ example: '65f1a2b3c4d5e6f708192a3b', description: 'User._id of the recipient when delivered to a person' })
    @IsOptional()
    @IsMongoId()
    deliveredToUserId?: string;

    @ApiPropertyOptional({ example: 'Somchai S.' })
    @IsOptional()
    @IsString()
    assignedUser?: string;

    @ApiPropertyOptional({ example: '65f1a2b3c4d5e6f708192a3b', description: 'User._id of the user the equipment was assigned to' })
    @IsOptional()
    @IsMongoId()
    assignedUserId?: string;

    @ApiPropertyOptional({ example: '2026-10-20' })
    @IsOptional()
    @IsDateString()
    deliveryDate?: string;

    @ApiPropertyOptional({ enum: PoprAssetStatus, example: PoprAssetStatus.IN_USE })
    @IsOptional()
    @IsEnum(PoprAssetStatus)
    assetStatus?: PoprAssetStatus;

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
    @ApiPropertyOptional({ enum: PoprStatus, example: PoprStatus.IN_PROGRESS, description: 'Defaults to DRAFT' })
    @IsOptional()
    @IsEnum(PoprStatus)
    status?: PoprStatus;

    @ApiPropertyOptional({ enum: PoprItemType, example: PoprItemType.ELECTRONIC, description: 'GENERAL skips serial number, OS and security requirements' })
    @IsOptional()
    @IsEnum(PoprItemType)
    itemType?: PoprItemType;

    @ApiPropertyOptional({ example: 2, minimum: 1, maximum: 4, description: 'Phase reached so far' })
    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(4)
    stage?: number;

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
