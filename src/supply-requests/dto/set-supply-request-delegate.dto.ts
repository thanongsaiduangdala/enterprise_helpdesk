import { ValidateIf, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetSupplyRequestDelegateDto {
  @ApiProperty({
    example: 'EMP002',
    nullable: true,
    description:
      'Employee code of the single person who will collect the items. Send null to clear the delegate.',
  })
  @ValidateIf((o: SetSupplyRequestDelegateDto) => o.delegateCode !== null)
  @IsString()
  delegateCode!: string | null;
}
