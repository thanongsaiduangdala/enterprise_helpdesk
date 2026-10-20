import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Room, RoomSchema } from './schemas/room.schema';
import {
  RoomMaintenance,
  RoomMaintenanceSchema,
} from './schemas/room-maintenance.schema';
import { RoomsService } from './rooms.service';
import { RoomsController } from './rooms.controller';
import { RoomBookingsModule } from '../room-bookings/room-bookings.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Room.name, schema: RoomSchema },
      { name: RoomMaintenance.name, schema: RoomMaintenanceSchema },
    ]),

    forwardRef(() => RoomBookingsModule),
  ],
  controllers: [RoomsController],
  providers: [RoomsService],
  exports: [RoomsService],
})
export class RoomsModule {}
