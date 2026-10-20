import { PartialType } from '@nestjs/swagger';
import { CreateRoomMaintenanceDto } from './create-room-maintenance.dto';

export class UpdateRoomMaintenanceDto extends PartialType(
  CreateRoomMaintenanceDto,
) {}
