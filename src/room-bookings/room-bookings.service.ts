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

    private async generateId(): Promise<string> {
        const bookings = await this.bookingModel
            .find({ _id: /^RB\d{3}$/ }, { _id: 1 })
            .sort({ _id: 1 })
            .exec();
        const usedNumbers = new Set(bookings.map((b) => parseInt(b._id.slice(2), 10)));
        let seq = 1;
        while (usedNumbers.has(seq)) seq++;
        return `RB${String(seq).padStart(3, '0')}`;
    }

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

    private async generateIdBatch(count: number): Promise<string[]> {
        const bookings = await this.bookingModel.find({ _id: /^RB\d{3}$/ }, { _id: 1 }).exec();
        const usedNumbers = new Set(bookings.map((b) => parseInt(b._id.slice(2), 10)));
        const ids: string[] = [];
        let seq = 1;
        while (ids.length < count) {
            if (!usedNumbers.has(seq)) {
                ids.push(`RB${String(seq).padStart(3, '0')}`);
                usedNumbers.add(seq);
            }
            seq++;
        }
        return ids;
    }

    async create(dto: CreateRoomBookingDto, bookedBy: string) {
        await this.roomsService.findOne(dto.roomId);
        const startAt = new Date(dto.startAt);
        const endAt = new Date(dto.endAt);

        // Non-recurring: unchanged single-booking path.
        if (!dto.recurrence) {
            await this.assertNoOverlap(dto.roomId, startAt, endAt);
            const [_id] = await this.generateIdBatch(1);
            const booking = new this.bookingModel({ _id, roomId: dto.roomId, bookedBy, startAt, endAt });
            return booking.save();
        }

        // Recurring: generate every occurrence's start/end (same time-of-day and duration,
        // stepping daily or weekly) up to and including `until`.
        const until = new Date(dto.recurrence.until);
        const stepDays = dto.recurrence.frequency === 'daily' ? 1 : 7;
        const durationMs = endAt.getTime() - startAt.getTime();

        const occurrences: { startAt: Date; endAt: Date }[] = [];
        let cursor = new Date(startAt);
        while (cursor <= until) {
            occurrences.push({ startAt: new Date(cursor), endAt: new Date(cursor.getTime() + durationMs) });
            cursor = new Date(cursor.getTime() + stepDays * 24 * 60 * 60 * 1000);
        }

        // Check every occurrence for a clash BEFORE creating any of them — one conflicting
        // slot shouldn't leave a partially-created series behind.
        for (const occ of occurrences) {
            await this.assertNoOverlap(dto.roomId, occ.startAt, occ.endAt);
        }

        const ids = await this.generateIdBatch(occurrences.length);
        const seriesId = ids[0];
        const recurrence = { frequency: dto.recurrence.frequency, until };

        const bookingsToInsert = occurrences.map((occ, i) => ({
            _id: ids[i],
            roomId: dto.roomId,
            bookedBy,
            startAt: occ.startAt,
            endAt: occ.endAt,
            recurrence,
            seriesId,
        }));

        return this.bookingModel.insertMany(bookingsToInsert);
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
