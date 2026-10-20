import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateSupplyCatalogItemDto } from './create-supply-catalog-item.dto';

// stockQty ຖືກຕັດອອກ — ຕ້ອງປັບຜ່ານ /adjust-stock ເທົ່ານັ້ນ ເພື່ອໃຫ້ມີ audit ທຸກຄັ້ງ
export class UpdateSupplyCatalogItemDto extends PartialType(
  OmitType(CreateSupplyCatalogItemDto, ['stockQty'] as const),
) {}
