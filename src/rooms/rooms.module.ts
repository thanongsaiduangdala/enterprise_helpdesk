import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Room, RoomSchema } from './schemas/room.schema';
import { RoomsService } from './rooms.service';
import { RoomsController } from './rooms.controller';
import { RoomBookingsModule } from '../room-bookings/room-bookings.module';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: Room.name, schema: RoomSchema }]),


        forwardRef(() => RoomBookingsModule),
    ],
    controllers: [RoomsController],
    providers: [RoomsService],
    exports: [RoomsService],
})
export class RoomsModule { }
