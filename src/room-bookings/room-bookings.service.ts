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
import { RejectRoomBookingDto } from './dto/reject-room-booking.dto';
import { RecordAttendeesDto } from './dto/record-attendees.dto';
import { RoomsService } from '../rooms/rooms.service';
import { RoomDocument, RoomStatus } from '../rooms/schemas/room.schema';
import { RoomBookingsGateway } from './room-bookings.gateway';

const MAX_RECURRING_OCCURRENCES = 60;
// ຖ້າຮອດເວລານັດແລ້ວບໍ່ມີໃຜ check-in ພາຍໃນເວລານີ້ (ນາທີ) — ຖືວ່າ no-show, ລະບົບຈະຍົກເລີກໃຫ້ອັດຕະໂນມັດ ແລະ ປ່ອຍຫ້ອງ
const NO_SHOW_GRACE_MINUTES = 15;
// ອະນຸຍາດ check-in ລ່ວງໜ້າກ່ອນເວລານັດໄດ້ຈັກນາທີ (ຄົນມາຮອດໄວກວ່ານັດ)
const EARLY_CHECKIN_GRACE_MINUTES = 5;

@Injectable()
export class RoomBookingsService {
    constructor(
        @InjectModel(RoomBooking.name) private bookingModel: Model<RoomBookingDocument>,
        @InjectModel(RoomBookingLock.name) private lockModel: Model<RoomBookingLockDocument>,
        @Inject(forwardRef(() => RoomsService)) private roomsService: RoomsService,
        private roomBookingsGateway: RoomBookingsGateway,
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




    private assertRoomBookable(room: RoomDocument) {
        if (room.status === RoomStatus.MAINTENANCE) {
            throw new BadRequestException('This room is currently under maintenance and cannot be booked');
        }
        if (!room.isActive) {
            throw new BadRequestException('This room is not currently available for booking');
        }
    }






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

            let saved;
            if (!dto.recurrence) {
                await this.assertNoOverlap(dto.roomId, startAt, endAt);
                const [_id] = await this.generateIdBatch(1);
                const booking = new this.bookingModel({ _id, roomId: dto.roomId, bookedBy, startAt, endAt, title: dto.title });
                saved = await booking.save();
            } else {
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
                    title: dto.title,
                }));

                saved = await this.bookingModel.insertMany(bookingsToInsert);
            }

            this.roomBookingsGateway.emitBookingsChanged(dto.roomId);
            return saved;
        });
    }

    findMyBookings(userId: string) {
        return this.bookingModel
            .find({ bookedBy: userId, status: { $ne: BookingStatus.CANCELLED } })
            .populate('roomId')
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

    findPendingApprovals() {
        return this.bookingModel
            .find({ status: BookingStatus.PENDING })
            .populate('roomId')
            .populate('bookedBy')
            .sort({ createdAt: 1 })
            .exec();
    }

    async approve(id: string, approverId: string) {
        const booking = await this.findOne(id);
        if (booking.status !== BookingStatus.PENDING) {
            throw new BadRequestException('This booking is not waiting for approval');
        }

        // Re-check for conflicts before locking it in — another request for the
        // same slot may have already been approved while this one was pending.
        await this.assertNoOverlap(
            booking.roomId.toString(),
            booking.startAt,
            booking.endAt,
            booking._id,
        );

        booking.status = BookingStatus.CONFIRMED;
        booking.reviewedBy = approverId as any;
        booking.reviewedAt = new Date();
        const saved = await booking.save();
        this.roomBookingsGateway.emitBookingsChanged(booking.roomId.toString());
        return saved;
    }

    async reject(id: string, approverId: string, dto: RejectRoomBookingDto) {
        const booking = await this.findOne(id);
        if (booking.status !== BookingStatus.PENDING) {
            throw new BadRequestException('This booking is not waiting for approval');
        }

        booking.status = BookingStatus.REJECTED;
        booking.reviewedBy = approverId as any;
        booking.reviewedAt = new Date();
        booking.rejectionReason = dto.reason;
        const saved = await booking.save();
        this.roomBookingsGateway.emitBookingsChanged(booking.roomId.toString());
        return saved;
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
            const saved = await booking.save();
            this.roomBookingsGateway.emitBookingsChanged(booking.roomId.toString());
            return saved;
        });
    }

    async cancel(id: string, requesterId: string) {
        const booking = await this.findOne(id);
        if (booking.bookedBy.toString() !== requesterId) {
            throw new BadRequestException('You can only cancel your own bookings');
        }

        booking.status = BookingStatus.CANCELLED;
        const saved = await booking.save();
        this.roomBookingsGateway.emitBookingsChanged(booking.roomId.toString());
        return saved;
    }

    async cancelSeries(seriesId: string, requesterId: string) {
        const bookings = await this.bookingModel.find({ seriesId }).exec();
        if (bookings.length === 0) {
            throw new NotFoundException('Booking series not found');
        }
        const notOwnedByRequester = bookings.some(
            (b) => b.bookedBy.toString() !== requesterId,
        );
        if (notOwnedByRequester) {
            throw new BadRequestException('You can only cancel your own bookings');
        }

        const cancellable = bookings.filter(
            (b) => b.status === BookingStatus.CONFIRMED || b.status === BookingStatus.PENDING,
        );
        if (cancellable.length > 0) {
            await this.bookingModel
                .updateMany(
                    { seriesId, status: { $in: [BookingStatus.CONFIRMED, BookingStatus.PENDING] } },
                    { $set: { status: BookingStatus.CANCELLED } },
                )
                .exec();
            this.roomBookingsGateway.emitBookingsChanged();
        }

        return { seriesId, cancelledCount: cancellable.length };
    }

    // ຢືນຢັນວ່າ "ເຂົ້າຫ້ອງແທ້ໆແລ້ວ" — ແຍກຈາກແຄ່ "ຈອງໄວ້" — ໃຊ້ຄິດໄລ່ liveStatus ໃຫ້ແມ່ນຍຳກວ່າເກົ່າ
    async checkIn(id: string, requesterId: string) {
        const booking = await this.findOne(id);
        if (booking.bookedBy.toString() !== requesterId) {
            throw new BadRequestException('You can only check in to your own bookings');
        }
        if (booking.status !== BookingStatus.CONFIRMED) {
            throw new BadRequestException('Only confirmed bookings can be checked in');
        }
        if (booking.checkedInAt) {
            throw new BadRequestException('This booking has already been checked in');
        }
        const now = new Date();
        const earliestAllowed = new Date(booking.startAt.getTime() - EARLY_CHECKIN_GRACE_MINUTES * 60000);
        if (now < earliestAllowed) {
            throw new BadRequestException(`Too early to check in — this booking starts at ${booking.startAt.toISOString()}`);
        }
        if (now >= booking.endAt) {
            throw new BadRequestException('This booking has already ended');
        }
        booking.checkedInAt = now;
        const saved = await booking.save();
        this.roomBookingsGateway.emitBookingsChanged(booking.roomId.toString());
        return saved;
    }

    // ຢືນຢັນວ່າ "ອອກຈາກຫ້ອງແລ້ວ" — ປ່ອຍຫ້ອງທັນທີ ເຖິງແມ່ນເວລາຈອງ (endAt) ຍັງບໍ່ຮອດ
    async checkOut(id: string, requesterId: string) {
        const booking = await this.findOne(id);
        if (booking.bookedBy.toString() !== requesterId) {
            throw new BadRequestException('You can only check out of your own bookings');
        }
        if (!booking.checkedInAt) {
            throw new BadRequestException('This booking has not been checked in yet');
        }
        if (booking.checkedOutAt) {
            throw new BadRequestException('This booking has already been checked out');
        }
        booking.checkedOutAt = new Date();
        const saved = await booking.save();
        this.roomBookingsGateway.emitBookingsChanged(booking.roomId.toString());
        return saved;
    }

    // ບັນທຶກລາຍຊື່ຄົນເຂົ້າຮ່ວມປະຊຸມ — ພຽງແຕ່ເຈົ້າຂອງ booking ເທົ່ານັ້ນທີ່ບັນທຶກໄດ້
    async recordAttendees(id: string, requesterId: string, dto: RecordAttendeesDto) {
        const booking = await this.findOne(id);
        if (booking.bookedBy.toString() !== requesterId) {
            throw new BadRequestException('You can only record attendees for your own bookings');
        }
        booking.attendees = dto.attendees;
        return booking.save();
    }

    // ຍົກເລີກ booking ທີ່ "ຈອງໄວ້ແຕ່ບໍ່ມາ" (ຮອດເວລານັດ+ເວລາຜ່ອນຜັນແລ້ວ ແຕ່ບໍ່ check-in) ໃຫ້ອັດຕະໂນມັດ —
    // ບໍ່ໄດ້ໃຊ້ cron ແຍກຕ່າງຫາກ, ຮຽກຈາກທຸກບ່ອນທີ່ຄິດໄລ່ວ່າຫ້ອງໃດ "ກຳລັງຖືກໃຊ້ຢູ່ຕອນນີ້" (lazy sweep)
    // ດັ່ງນັ້ນຫ້ອງຈະຖືກປ່ອຍທັນທີທີ່ມີຄົນມາເບິ່ງລາຍຊື່ຫ້ອງ ໂດຍບໍ່ຕ້ອງລໍຖ້າ job ພື້ນຫຼັງ
    private async releaseNoShowBookings(roomIds?: string[]) {
        const cutoff = new Date(Date.now() - NO_SHOW_GRACE_MINUTES * 60000);
        const filter: any = {
            status: BookingStatus.CONFIRMED,
            checkedInAt: null,
            startAt: { $lte: cutoff },
            endAt: { $gt: new Date() },
        };
        if (roomIds && roomIds.length > 0) {
            filter.roomId = { $in: roomIds };
        }
        await this.bookingModel
            .updateMany(filter, {
                $set: {
                    status: BookingStatus.CANCELLED,
                    rejectionReason: `ຍົກເລີກອັດຕະໂນມັດ: ບໍ່ໄດ້ check-in ພາຍໃນ ${NO_SHOW_GRACE_MINUTES} ນາທີຫຼັງເວລານັດ (no-show)`,
                },
            })
            .exec();
    }

    async isRoomBookedAt(roomId: string, at: Date): Promise<boolean> {
        await this.releaseNoShowBookings([roomId]);
        const clash = await this.bookingModel
            .findOne({
                roomId,
                status: BookingStatus.CONFIRMED,
                startAt: { $lte: at },
                endAt: { $gt: at },
                checkedOutAt: null, // check-out ແລ້ວ = ປ່ອຍຫ້ອງທັນທີ ເຖິງແມ່ນ endAt ຍັງບໍ່ຮອດ
            })
            .exec();
        return !!clash;
    }

    // ເອົາ id ຫ້ອງທັງໝົດທີ່ "ກຳລັງຖືກໃຊ້ຢູ່ຕອນນີ້" (ມີ booking CONFIRMED ຄອບຄຸມເວລາປັດຈຸບັນ, ຍັງບໍ່ check-out) — ໃນຄິວດຽວ
    // ໃຊ້ໂດຍ RoomsService.findAllWithLiveStatus() ເພື່ອຫຼີກລ້ຽງການ query ເປັນຮ້ອຍໆຄັ້ງ (N+1) ຕອນສະແດງລາຍຊື່ຫ້ອງທັງໝົດ
    async findRoomIdsBookedAt(roomIds: string[], at: Date): Promise<Set<string>> {
        if (roomIds.length === 0) return new Set();
        await this.releaseNoShowBookings(roomIds);
        const clashes = await this.bookingModel
            .find({
                roomId: { $in: roomIds },
                status: BookingStatus.CONFIRMED,
                startAt: { $lte: at },
                endAt: { $gt: at },
                checkedOutAt: null,
            })
            .select('roomId')
            .exec();
        return new Set(clashes.map((c) => String(c.roomId)));
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