import {
    BadRequestException,
    ConflictException,
    forwardRef,
    Inject,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
    RoomBooking,
    RoomBookingDocument,
    BookingStatus,
} from './schemas/room-booking.schema';
import { CreateRoomBookingDto } from './dto/create-room-booking.dto';
import { RescheduleRoomBookingDto } from './dto/reschedule-room-booking.dto';
import { RoomsService } from '../rooms/rooms.service';

@Injectable()
export class RoomBookingsService {
    constructor(
        @InjectModel(RoomBooking.name) private bookingModel: Model<RoomBookingDocument>,
        @Inject(forwardRef(() => RoomsService)) private roomsService: RoomsService,
    ) { }

    // Core overlap check: two CONFIRMED bookings on the same room clash if
    // (existing.start < newEnd) AND (existing.end > newStart).
    private async assertNoOverlap(
        roomId: string,
        startAt: Date,
        endAt: Date,
        excludeBookingId?: string,
    ) {
        if (endAt <= startAt) {
            throw new BadRequestException('endAt must be after startAt');
        }
        const filter: any = {
            roomId,
            status: BookingStatus.CONFIRMED,
            startAt: { $lt: endAt },
            endAt: { $gt: startAt },
        };
        if (excludeBookingId) {
            filter._id = { $ne: excludeBookingId };
        }
        const clash = await this.bookingModel.findOne(filter).exec();
        if (clash) {
            throw new ConflictException('This room is already booked for the requested time slot');
        }
    }

    async create(dto: CreateRoomBookingDto, bookedBy: string) {
        await this.roomsService.findOne(dto.roomId); // throws 404 if room doesn't exist
        const startAt = new Date(dto.startAt);
        const endAt = new Date(dto.endAt);
        await this.assertNoOverlap(dto.roomId, startAt, endAt);

        const booking = new this.bookingModel({
            roomId: dto.roomId,
            bookedBy,
            startAt,
            endAt,
            recurrence: dto.recurrence
                ? { frequency: dto.recurrence.frequency, until: new Date(dto.recurrence.until) }
                : undefined,
        });
        return booking.save();
    }

    findMyBookings(userId: string) {
        return this.bookingModel
            .find({ bookedBy: userId, status: BookingStatus.CONFIRMED })
            .sort({ startAt: 1 })
            .exec();
    }

    // Room calendar view (day/week): pass `from`/`to` as the window boundaries.
    findForRoom(roomId: string, from: Date, to: Date) {
        return this.bookingModel
            .find({
                roomId,
                status: BookingStatus.CONFIRMED,
                startAt: { $lt: to },
                endAt: { $gt: from },
            })
            .sort({ startAt: 1 })
            .exec();
    }

    async findOne(id: string) {
        const booking = await this.bookingModel.findById(id).exec();
        if (!booking) throw new NotFoundException('Booking not found');
        return booking;
    }

    async reschedule(id: string, dto: RescheduleRoomBookingDto, requesterId: string) {
        const booking = await this.findOne(id);
        if (booking.bookedBy.toString() !== requesterId) {
            throw new BadRequestException('You can only reschedule your own bookings');
        }
        const startAt = new Date(dto.startAt);
        const endAt = new Date(dto.endAt);
        // exclude the booking's own current slot from the clash check, or it'd always conflict with itself
        await this.assertNoOverlap(booking.roomId.toString(), startAt, endAt, id);
        booking.startAt = startAt;
        booking.endAt = endAt;
        return booking.save();
    }

    async cancel(id: string, requesterId: string) {
        const booking = await this.findOne(id);
        if (booking.bookedBy.toString() !== requesterId) {
            throw new BadRequestException('You can only cancel your own bookings');
        }
        // soft-cancel (status flip) rather than hard delete, so history/audit stays intact
        booking.status = BookingStatus.CANCELLED;
        return booking.save();
    }

    // Used by RoomsService to compute a room's "live" status (Available vs Booked-right-now).
    async isRoomBookedAt(roomId: string, at: Date): Promise<boolean> {
        const clash = await this.bookingModel
            .findOne({
                roomId,
                status: BookingStatus.CONFIRMED,
                startAt: { $lte: at },
                endAt: { $gt: at },
            })
            .exec();
        return !!clash;
    }

    // Org-wide room utilization report: total booked minutes + booking count per room.
    async utilizationReport(from: Date, to: Date) {
        return this.bookingModel.aggregate([
            {
                $match: {
                    status: BookingStatus.CONFIRMED,
                    startAt: { $lt: to },
                    endAt: { $gt: from },
                },
            },
            {
                $group: {
                    _id: '$roomId',
                    bookedMinutes: {
                        $sum: { $divide: [{ $subtract: ['$endAt', '$startAt'] }, 60000] },
                    },
                    bookingCount: { $sum: 1 },
                },
            },
            { $sort: { bookedMinutes: -1 } },
        ]);
    }
}
