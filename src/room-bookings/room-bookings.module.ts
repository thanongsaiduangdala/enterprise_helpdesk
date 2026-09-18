import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RoomBooking, RoomBookingSchema } from './schemas/room-booking.schema';
import { RoomBookingLock, RoomBookingLockSchema } from './schemas/room-booking-lock.schema';
import { RoomBookingsService } from './room-bookings.service';
import { RoomBookingsController } from './room-bookings.controller';
import { RoomBookingsGateway } from './room-bookings.gateway';
import { RoomsModule } from '../rooms/rooms.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: RoomBooking.name, schema: RoomBookingSchema },
            { name: RoomBookingLock.name, schema: RoomBookingLockSchema },
        ]),
        forwardRef(() => RoomsModule),
    ],
    controllers: [RoomBookingsController],
    providers: [RoomBookingsService, RoomBookingsGateway],
    exports: [RoomBookingsService, RoomBookingsGateway],
})
export class RoomBookingsModule { }