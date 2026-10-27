import { IsMongoId, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AssignDepartmentDto {
  @ApiProperty({ example: 'DX001', description: 'ພະແນກທີ່ເປັນເຈົ້າຂອງຊັບສິນ' })
  @IsNotEmpty({ message: 'ກະລຸນາເລືອກພະແນກ' })
  @IsString()
  departmentId!: string;

  @ApiProperty({
    example: '665fbb1f2c1a4e3b9c8d0a11',
    description: 'ຜູ້ຮັບຜິດຊອບ (users._id) — ຫົວໜ້າພະແນກ ຫຼືພະນັກງານໃນພະແນກ',
  })
  @IsMongoId({ message: 'ກະລຸນາເລືອກຜູ້ຮັບຜິດຊອບ' })
  custodianId!: string;

  @ApiPropertyOptional({
    description: 'ຜູ້ມາຮັບເຄື່ອງຈິງ (ຮັບແທນຜູ້ຮັບຜິດຊອບ) — ຕ້ອງຢູ່ພະແນກດຽວກັນ',
  })
  @IsOptional()
  @IsMongoId()
  receivedById?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}