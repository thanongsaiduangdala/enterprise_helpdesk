import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Room, RoomSchema } from './schemas/room.schema';
import { RoomsService } from './rooms.service';
import { RoomsController } from './rooms.controller';
import { RoomBookingsModule } from '../room-bookings/room-bookings.module';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: Room.name, schema: RoomSchema }]),
        // circular: RoomsService needs RoomBookingsService for live status + utilization,
        // and RoomBookingsService needs RoomsService to validate a room exists on create.
        forwardRef(() => RoomBookingsModule),
    ],
    controllers: [RoomsController],
    providers: [RoomsService],
    exports: [RoomsService],
})
export class RoomsModule { }
