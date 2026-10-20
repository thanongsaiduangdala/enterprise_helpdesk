import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RoomBooking, RoomBookingSchema } from './schemas/room-booking.schema';
import {
  RoomBookingLock,
  RoomBookingLockSchema,
} from './schemas/room-booking-lock.schema';
import { RoomBookingsService } from './room-bookings.service';
import { RoomBookingsController } from './room-bookings.controller';
import { RoomBookingsGateway } from './room-bookings.gateway';
import { RoomInvitesService } from './room-invites.service';
import { RoomInvitesController } from './room-invites.controller';
import { RoomJoinController } from './room-join.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { RoomsModule } from '../rooms/rooms.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Branch, BranchSchema } from '../branches/schemas/branch.schema';
import {
  Department,
  DepartmentSchema,
} from '../departments/schemas/department.schema';
import { Role, RoleSchema } from '../roles/schemas/role.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RoomBooking.name, schema: RoomBookingSchema },
      { name: RoomBookingLock.name, schema: RoomBookingLockSchema },
      { name: User.name, schema: UserSchema },
      { name: Branch.name, schema: BranchSchema },
      { name: Department.name, schema: DepartmentSchema },
      { name: Role.name, schema: RoleSchema },
    ]),
    forwardRef(() => RoomsModule),
    NotificationsModule,
  ],
  controllers: [
    RoomBookingsController,
    RoomInvitesController,
    RoomJoinController,
  ],
  providers: [RoomBookingsService, RoomBookingsGateway, RoomInvitesService],
  exports: [RoomBookingsService, RoomBookingsGateway],
})
export class RoomBookingsModule {}
