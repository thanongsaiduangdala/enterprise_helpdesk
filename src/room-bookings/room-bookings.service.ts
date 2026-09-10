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
import { RoomBookingLock, RoomBookingLockDocument } from './schemas/room-booking-lock.schema';
import { CreateRoomBookingDto } from './dto/create-room-booking.dto';
import { RescheduleRoomBookingDto } from './dto/reschedule-room-booking.dto';
import { RoomsService } from '../rooms/rooms.service';
import { RoomDocument, RoomStatus } from '../rooms/schemas/room.schema';

// A daily recurrence with a distant "until" date would otherwise generate thousands of
// occurrences, each needing its own overlap check — slow, and an easy accidental (or
// deliberate) resource-exhaustion vector. This caps it to something sane: about a year
// of weekly bookings, or two months of daily ones.
const MAX_RECURRING_OCCURRENCES = 60;

@Injectable()
export class RoomBookingsService {
    constructor(
        @InjectModel(RoomBooking.name) private bookingModel: Model<RoomBookingDocument>,
        @InjectModel(RoomBookingLock.name) private lockModel: Model<RoomBookingLockDocument>,
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

    // A room under maintenance or deactivated shouldn't be bookable at all — this was
    // previously checked nowhere, meaning the "disable a room" admin feature had no
    // actual effect on booking.
    private assertRoomBookable(room: RoomDocument) {
        if (room.status === RoomStatus.MAINTENANCE) {
            throw new BadRequestException('This room is currently under maintenance and cannot be booked');
        }
        if (!room.isActive) {
            throw new BadRequestException('This room is not currently available for booking');
        }
    }

    // Serializes any booking-affecting operation for a single room. Acquire by
    // inserting a lock document (fails with a duplicate-key error if someone else holds
    // it), retry briefly on contention, always release in `finally`. This is what
    // actually closes the double-booking race — see room-booking-lock.schema.ts for why
    // a transaction alone wouldn't.
    private async withRoomLock<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
        const maxAttempts = 20;
        const retryDelayMs = 150;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                await this.lockModel.create({ _id: roomId, lockedAt: new Date() });
            } catch (err: any) {
                if (err.code === 11000) {
                    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
                    continue;
                }
                throw err;
            }

            try {
                return await fn();
            } finally {
                await this.lockModel.deleteOne({ _id: roomId }).exec();
            }
        }

        throw new ConflictException('This room is busy processing another booking request — please try again');
    }

    async create(dto: CreateRoomBookingDto, bookedBy: string) {
        const room = await this.roomsService.findOne(dto.roomId);
        this.assertRoomBookable(room);

        return this.withRoomLock(dto.roomId, async () => {
            const startAt = new Date(dto.startAt);
            const endAt = new Date(dto.endAt);

            if (!dto.recurrence) {
                await this.assertNoOverlap(dto.roomId, startAt, endAt);
                const [_id] = await this.generateIdBatch(1);
                const booking = new this.bookingModel({ _id, roomId: dto.roomId, bookedBy, startAt, endAt });
                return booking.save();
            }

            const until = new Date(dto.recurrence.until);
            const stepDays = dto.recurrence.frequency === 'daily' ? 1 : 7;
            const durationMs = endAt.getTime() - startAt.getTime();

            const occurrences: { startAt: Date; endAt: Date }[] = [];
            let cursor = new Date(startAt);
            while (cursor <= until) {
                occurrences.push({ startAt: new Date(cursor), endAt: new Date(cursor.getTime() + durationMs) });
                cursor = new Date(cursor.getTime() + stepDays * 24 * 60 * 60 * 1000);
            }

            if (occurrences.length > MAX_RECURRING_OCCURRENCES) {
                throw new BadRequestException(
                    `This recurrence would create ${occurrences.length} bookings, over the limit of ${MAX_RECURRING_OCCURRENCES}. Choose a shorter "until" date.`,
                );
            }

            // Safe to check every occurrence concurrently here — the room-wide lock
            // above already serializes this entire operation against any OTHER request
            // for this room, so there's no external race for these checks to lose to.
            await Promise.all(occurrences.map((occ) => this.assertNoOverlap(dto.roomId, occ.startAt, occ.endAt)));

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
        });
    }

    findMyBookings(userId: string) {
        return this.bookingModel
            .find({ bookedBy: userId, status: BookingStatus.CONFIRMED })
            .sort({ startAt: 1 })
            .exec();
    }

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
        const room = await this.roomsService.findOne(booking.roomId);
        this.assertRoomBookable(room);

        const startAt = new Date(dto.startAt);
        const endAt = new Date(dto.endAt);

        return this.withRoomLock(booking.roomId.toString(), async () => {
            await this.assertNoOverlap(booking.roomId.toString(), startAt, endAt, id);
            booking.startAt = startAt;
            booking.endAt = endAt;
            return booking.save();
        });
    }

    async cancel(id: string, requesterId: string) {
        const booking = await this.findOne(id);
        if (booking.bookedBy.toString() !== requesterId) {
            throw new BadRequestException('You can only cancel your own bookings');
        }

        booking.status = BookingStatus.CANCELLED;
        return booking.save();
    }

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