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
import { parse } from 'csv-parse/sync';
import {
    RoomBooking,
    RoomBookingDocument,
    BookingStatus,
    RoomBookingHistoryEntry,
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

// ຂໍ້ມູນສະເພາະຕິດທີ່ເຮັດໃຫ້ຜູ້ອະນຸມັດກວດຊົ່ວກັນໄດ້ ເວລາຢູ່ໃນຫ້ອງເດີວກັນ
export interface BookingConflictRef {
    _id: string;
    title?: string;
    startAt: Date;
    endAt: Date;
    bookedBy: { firstName?: string; lastName?: string; email?: string } | null;
}

// toObject() ຂອງ Mongoose ມີ document type ຫຼາຍເຊັນ compiler ຈະ serialize ແອນ TypeError (TS7056)
// ຈຶ່ງປະເພາດເປັນ Record ທີ່ມີ field ທີ່ເພິ່ມມາກຳນົດ type ໄວ້ຊັດເຈນ
export type PendingApprovalView = Record<string, any> & {
    conflictWith: BookingConflictRef[];
    blockedBy: BookingConflictRef[];
};

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

    // ສ້າງ entry ສຳລັບປະຫວັດການຈອງ (append-only) — ໃຊ້ກັບທັງ booking ໃໝ່ ແລະ ການປ່ຽນແປງຕ່າງໆ
    private historyEvent(
        action: string,
        extra: Record<string, any> = {},
    ): RoomBookingHistoryEntry {
        return { action, at: new Date(), ...extra } as RoomBookingHistoryEntry;
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
                const booking = new this.bookingModel({
                    _id,
                    roomId: dto.roomId,
                    bookedBy,
                    startAt,
                    endAt,
                    title: dto.title,
                    history: [
                        this.historyEvent('CREATED', {
                            toStartAt: startAt,
                            toEndAt: endAt,
                            actorId: bookedBy,
                        }),
                    ],
                });
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
                    history: [
                        this.historyEvent('CREATED', {
                            toStartAt: occ.startAt,
                            toEndAt: occ.endAt,
                            actorId: bookedBy,
                        }),
                    ],
                }));

                saved = await this.bookingModel.insertMany(bookingsToInsert);
            }

            this.roomBookingsGateway.emitBookingsChanged(dto.roomId);
            return saved;
        });
    }

    async bulkImport(fileBuffer: Buffer, bookedBy: string) {
        let rows: Record<string, string>[];
        try {
            rows = parse(fileBuffer, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });
        } catch (err: any) {
            throw new ConflictException(`Could not parse CSV file: ${err.message}`);
        }

        const results: Array<{ row: number; reference: string; success: boolean; error?: string }> = [];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNumber = i + 2;
            try {
                if (!row.title || !row.roomId || !row.startAt || !row.endAt) {
                    throw new Error('Missing one or more required fields (title, roomId, startAt, endAt)');
                }
                if (Number.isNaN(new Date(row.startAt).getTime())) {
                    throw new Error('startAt must be a valid date (e.g. 2026-09-22T09:00:00.000Z)');
                }
                if (Number.isNaN(new Date(row.endAt).getTime())) {
                    throw new Error('endAt must be a valid date (e.g. 2026-09-22T10:00:00.000Z)');
                }
                const dto: CreateRoomBookingDto = {
                    title: row.title,
                    roomId: row.roomId,
                    startAt: row.startAt,
                    endAt: row.endAt,
                };
                await this.create(dto, bookedBy);
                results.push({ row: rowNumber, reference: row.title, success: true });
            } catch (error: any) {
                results.push({ row: rowNumber, reference: row.title ?? '', success: false, error: error.message ?? 'Unknown error' });
            }
        }

        return {
            total: rows.length,
            created: results.filter((r) => r.success).length,
            failed: results.filter((r) => !r.success).length,
            results,
        };
    }

    findMyBookings(userId: string) {
        return this.bookingModel
            .find({ bookedBy: userId })
            .populate('roomId')
            // ໃຫ້ມີຊື່ຜູ້ກະທຳໃນປະຫວັດ (ຜູ້ຂໍ ແລະ ຜູ້ອະນຸມັດ) ເພື່ອສະແດງໃນ popup
            .populate({ path: 'history.actorId', select: 'firstName lastName email' })
            .sort({ startAt: -1 })
            .exec();
    }

    /**
     * `viewerId` is set for callers who are only allowed to see their own
     * bookings. Other rows are still returned — the room calendar has to show
     * that a slot is taken to avoid double-booking — but the identity fields
     * are stripped so an employee can't enumerate who booked what.
     */
    async findForRoom(from: Date, to: Date, roomId?: string, viewerId?: string) {
        const filter: any = {
            status: BookingStatus.CONFIRMED,
            startAt: { $lt: to },
            endAt: { $gt: from },
        };
        if (roomId) filter.roomId = roomId;

        const bookings = await this.bookingModel
            .find(filter)
            .select('-history') // ຕາຕະລາງບໍ່ຕ້ອງການປະຫວັດ — ຫຼຸດຂະໜາດຄຳຕອບ ແລະ ບໍ່ຮົ່ວຂໍ້ມູນຜູ້ອື່ນ
            .populate('bookedBy', 'firstName lastName email') // ຕ້ອງການຊື່ຜູ້ຈອງໃສ່ note hover ຂອງກ່ອງການຈອງ (ຈະຖືກ redact ຂ້າງລຸ່ມ ຖ້າຜູ້ເບິ່ງບໍ່ມີສິດ)
            .sort({ startAt: 1 })
            .exec();

        if (!viewerId) return bookings;

        return bookings.map((booking) => {
            const bookedBy: any = booking.bookedBy;
            const ownerId = bookedBy && typeof bookedBy === 'object'
                ? String(bookedBy._id ?? '')
                : String(bookedBy ?? '');
            if (ownerId === viewerId) return booking;
            const redacted: Record<string, any> = booking.toObject();
            redacted.bookedBy = null;
            redacted.reviewedBy = null;
            redacted.attendees = [];
            return redacted;
        });
    }

    async findOne(id: string) {
        // ຂໍ້ມູນເດີມ (legacy) ບາງລາຍການເກັບ _id ເປັນ MongoDB ObjectId (ກ່ອນມີລະບົບ RBxxx ແລະ schema ປ່ຽນເປັນ String)
        // ຖ້າຊອກດ້ວຍ findById(id) ແບບທຳມະດາ Mongoose ຈະ cast id ຕາມ type ຂອງ schema ເປັນ String
        // ຈຶ່ງບໍ່ກົງກັບ ObjectId ທີ່ເກັບໄວ້ໃນຖານຂໍ້ມູນ => 404 ທັງທີ່ລາຍການມີຢູ່ (approve/reject/etc ເປັນອັນເປັນອານ)
        // ຈຶ່ງຊອກໂດຍແປງ _id ທີ່ເກັບໄວ້ໃຫ້ເປັນ string ແລ້ວທຽບກັບ id ທີ່ສົ່ງເຂົ້າມາ — ເຮັດວຽກກັບ ທັງ RBxxx ແລະ ObjectId
        const booking = await this.bookingModel
            .findOne({ $expr: { $eq: [{ $toString: '$_id' }, id] } })
            .exec();
        if (!booking) throw new NotFoundException('Booking not found');
        return booking;
    }

    // ກວດຊົ່ວກັນໃຫ້ຜູ້ອະນຸມັດເຫັນກ່ອນກົດ "ອະນຸມັດ" — assertNoOverlap ກວດເທົ່ນ booking ທີ່ CONFIRMED
    // ດັ່ງນັ້ນຄຳຮ້ອງ PENDING ຫຼາຍລາຍການຈຶ່ງຈອກຊົ່ວກັນໄດ້ໂດຍບໍ່ມີຜູ້ເຫັງໃຫ້ກ່ອນ ແລະ ກົດອະນຸມັດລາຍການທີ່ຊົ່ວກັນ
    // ຈະໄດ້ 409 ຈາກ assertNoOverlap ເມື່ອກົດ ("already booked for the requested time slot")
    // ຄືນຄືນໃຫ້ແຕ່ລະລາຍການ:
    //   conflictWith = ຄຳຮ້ອງ PENDING ອື່ນ ທີ່ຊົ່ວກັນ (ຕ້ອງເລືອກວ່າຈະອະນຸມັດລາຍການໃດ)
    //   blockedBy    = booking ທີ່ CONFIRMED ແລ້ວ ທີ່ຊົ່ວກັນ (ອະນຸມັດຈະໂດນ 409 ທັນທີ — ຕ້ອງແກ້ໄຂຫຼືໃຫ້ຜູ້ຂໍປ່ຽນເວລາ)
    async findPendingApprovals(): Promise<PendingApprovalView[]> {
        // ມີ 2 ປະເພດຄຳຮ້ອງທີ່ລໍຖ້າອະນຸມັດ:
        //   1) ຄຳຮ້ອງຈອງໃໝ່  — status = PENDING (ເວລາຢູ່ startAt/endAt)
        //   2) ຄຳຮ້ອງເລື່ອນເວລາ — booking ຍັງ CONFIRMED ຢູ່ເວລາເດີມ ແຕ່ມີ pendingStartAt (ເວລາໃໝ່ທີ່ຂໍປ່ຽນ)
        const newRequests = await this.bookingModel
            .find({ status: BookingStatus.PENDING })
            .populate('roomId')
            .populate('bookedBy')
            .sort({ createdAt: 1 })
            .exec();

        const reschedules = await this.bookingModel
            .find({
                pendingStartAt: { $ne: null },
                pendingEndAt: { $ne: null },
                status: { $nin: [BookingStatus.CANCELLED, BookingStatus.REJECTED] },
            })
            .populate('roomId')
            .populate('bookedBy')
            .sort({ pendingRequestedAt: 1 })
            .exec();

        // ບໍ່ມີຄຳຮ້ອງເວລາຢູ່ລໍຖ້າອະນຸມັດ — ຄືນ array ວ່າງ (ບໍ່ມີ conflict ໃດຕ້ອງຄິດ)
        if (newRequests.length === 0 && reschedules.length === 0) return [];

        // ແຕ່ລະລາຍການມີ "ເວລາທີ່ຈະຖືກອະນຸມັດ" (effective): ຄຳຮ້ອງໃໝ່ = startAt/endAt, ຄຳຮ້ອງເລື່ອນເວລາ = pendingStartAt/End
        const items = [
            ...newRequests.map((doc) => ({
                doc,
                startAt: doc.startAt as Date,
                endAt: doc.endAt as Date,
                isReschedule: false,
                originalStartAt: null as Date | null,
                originalEndAt: null as Date | null,
            })),
            ...reschedules.map((doc) => ({
                doc,
                startAt: doc.pendingStartAt as Date,
                endAt: doc.pendingEndAt as Date,
                isReschedule: true,
                originalStartAt: doc.startAt as Date,
                originalEndAt: doc.endAt as Date,
            })),
        ];

        items.sort((a, b) => {
            const aTime = a.isReschedule
                ? a.doc.pendingRequestedAt ?? (a.doc as any).createdAt
                : (a.doc as any).createdAt;
            const bTime = b.isReschedule
                ? b.doc.pendingRequestedAt ?? (b.doc as any).createdAt
                : (b.doc as any).createdAt;
            return new Date(aTime as any).getTime() - new Date(bTime as any).getTime();
        });

        // ດຶງ booking ທີ່ CONFIRMED ແລ້ວທີ່ທັບເວລາຂອງຄຳຮ້ອງເທົ່ນ ເພື່ອກວດຊົ່ວກັນຢ່າງຄົນລະອຽນ
        const minStart = new Date(Math.min(...items.map((p) => p.startAt.getTime())));
        const maxEnd = new Date(Math.max(...items.map((p) => p.endAt.getTime())));
        const confirmed = await this.bookingModel
            .find({
                status: BookingStatus.CONFIRMED,
                startAt: { $lt: maxEnd },
                endAt: { $gt: minStart },
            })
            .populate('bookedBy')
            .exec();

        // roomId ຖືກ populate ໃນ pending (ເປັນ object) ແຕ່ບໍ່ໄດ້ populate ໃນ confirmed (ຢັງເປັນ string) —
        // ໃຫ້ເອົາ _id ອອກມາທຽບກັນໃຫ້ຄືກັນ ບໍ່ຕ້ອງແກ້ ຫຼື populate ທັງສອງຝັ່ງທີ່ບໍ່ຈຳເປັນ
        const roomKey = (roomId: any) => String(roomId?._id ?? roomId ?? '');

        // ເຊີ່ວເປັນ [startAt, endAt) ແບບ half-open ຊຶ່ງເທົ່ນ assertNoOverlap ($lt/$gt) —
        // ຈອງຕໍ່ກັນ (09:00-10:00 ຕໍ່ 10:00-11:00) ບໍ່ນັບຊົ່ວກັນ
        const overlaps = (a: any, b: any) => a.startAt < b.endAt && b.startAt < a.endAt;

        const summarize = (b: any) => ({
            _id: b._id,
            title: b.title,
            startAt: b.startAt,
            endAt: b.endAt,
            bookedBy: b.bookedBy
                ? {
                    firstName: b.bookedBy.firstName,
                    lastName: b.bookedBy.lastName,
                    email: b.bookedBy.email,
                }
                : null,
        });

        return items.map((item) => {
            const booking = item.doc;
            const room = roomKey(booking.roomId);
            const selfId = booking._id.toString();
            const selfRange = { startAt: item.startAt, endAt: item.endAt };

            const conflictWith = items.filter(
                (other) => other.doc._id.toString() !== selfId
                    && roomKey(other.doc.roomId) === room
                    && overlaps(selfRange, { startAt: other.startAt, endAt: other.endAt }),
            );
            // ບໍ່ນັບ booking ຕົວເອງ (legacy/CONFIRMED) — ມັນຢູ່ໃນຜົນຂອງ confirmed ເພາະຍັງ CONFIRMED ຢູ່ເວລາເດີມ
            const blockedBy = confirmed.filter(
                (other) => roomKey(other.roomId) === room
                    && other._id.toString() !== selfId
                    && overlaps(selfRange, other),
            );

            return {
                ...booking.toObject(),
                // ສະແດງເວລາທີ່ "ຈະປ່ຽນໄປ / ຈະຖືກອະນຸມັດ" ໃຫ້ຜູ້ອະນຸມັດເຫັນ
                startAt: item.startAt,
                endAt: item.endAt,
                isReschedule: item.isReschedule,
                originalStartAt: item.originalStartAt,
                originalEndAt: item.originalEndAt,
                conflictWith: conflictWith.map((c) => {
                    const otherBookedBy = c.doc.bookedBy as any;
                    return {
                        _id: c.doc._id,
                        title: c.doc.title,
                        startAt: c.startAt,
                        endAt: c.endAt,
                        bookedBy: otherBookedBy
                            ? {
                                firstName: otherBookedBy.firstName,
                                lastName: otherBookedBy.lastName,
                                email: otherBookedBy.email,
                            }
                            : null,
                    };
                }),
                blockedBy: blockedBy.map(summarize),
            };
        });
    }

    async approve(id: string, approverId: string) {
        const booking = await this.findOne(id);

        // ກໍລະນີຄຳຮ້ອງເລື່ອນເວລາ: booking ຍັງ CONFIRMED ຢູ່ເວລາເດີມ ແລະ ມີເວລາໃໝ່ລໍຖ້າອະນຸມັດ (pendingStartAt)
        // ອະນຸມັດ = ຍ້າຍໄປເວລາໃໝ່ ແລະ ລຶບຂໍ້ມູນລໍຖ້າ ສ່ວນ status ຍັງເປັນ CONFIRMED
        if (booking.pendingStartAt && booking.pendingEndAt) {
            await this.assertNoOverlap(
                booking.roomId.toString(),
                booking.pendingStartAt,
                booking.pendingEndAt,
                booking._id,
            );

            const saved = await this.bookingModel
                .findOneAndUpdate(
                    {
                        $expr: { $eq: [{ $toString: '$_id' }, id] },
                        pendingStartAt: { $ne: null },
                    },
                    {
                        $set: {
                            startAt: booking.pendingStartAt,
                            endAt: booking.pendingEndAt,
                            reviewedBy: approverId,
                            reviewedAt: new Date(),
                        },
                        $unset: {
                            pendingStartAt: '',
                            pendingEndAt: '',
                            pendingRequestedAt: '',
                            rescheduleRejectionReason: '',
                        },
                        $push: {
                            history: this.historyEvent('RESCHEDULE_APPROVED', {
                                fromStartAt: booking.startAt,
                                fromEndAt: booking.endAt,
                                toStartAt: booking.pendingStartAt,
                                toEndAt: booking.pendingEndAt,
                                actorId: approverId,
                            }),
                        },
                    },
                    { new: true },
                )
                .exec();
            if (!saved) {
                await this.findOne(id);
                throw new BadRequestException('This booking has no pending reschedule');
            }
            this.roomBookingsGateway.emitBookingsChanged(saved.roomId.toString());
            return saved;
        }

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

        const saved = await this.reviewPending(
            id,
            {
                status: BookingStatus.CONFIRMED,
                reviewedBy: approverId,
                reviewedAt: new Date(),
            },
            { history: this.historyEvent('APPROVED', { actorId: approverId }) },
        );
        this.roomBookingsGateway.emitBookingsChanged(saved.roomId.toString());
        return saved;
    }

    // ອັບເດດ booking ທີ່ PENDING ແບບ atomic ຜ່ານ $toString(_id) — ບໍ່ໃຊ້ booking.save()
    // ເພາະ legacy booking ທີ່ _id ເປັນ ObjectId: save() ຈະ filter ດ້ວຍ _id ແບບ String ແລ້ວບໍ່ເຈໍເອກະສານ
    // => DocumentNotFoundError => 500 (ເກີດກັບຄຳຮ້ອງເກົ່າ/ໝົດອາຍຸ). ການ updateOne ດ້ວຍ $expr ໃຊ້ໄດ້ທັງ RBxxx ແລະ ObjectId
    private async reviewPending(id: string, set: Record<string, any>, push?: Record<string, any>) {
        const update: Record<string, any> = { $set: set };
        if (push) update.$push = push;
        const updated = await this.bookingModel
            .findOneAndUpdate(
                {
                    $expr: { $eq: [{ $toString: '$_id' }, id] },
                    status: BookingStatus.PENDING,
                },
                update,
                { new: true },
            )
            .exec();
        if (!updated) {
            // ແຍກ 404 ອອກຈາກ "ບໍ່ແມ່ນ PENDING"
            await this.findOne(id);
            throw new BadRequestException('This booking is not waiting for approval');
        }
        return updated;
    }

    async reject(id: string, approverId: string, dto: RejectRoomBookingDto) {
        const booking = await this.findOne(id);

        // ກໍລະນີຄຳຮ້ອງເລື່ອນເວລາ: ປະຕິເສດ = ພຽງແຕ່ລຶບຄຳຮ້ອງເລື່ອນເວລາອອກ ແລະ ຄົງ booking ທີ່ອະນຸມັດແລ້ວໄວ້ຕາມເດີມ
        // (ບໍ່ປ່ຽນເປັນ REJECTED — ຜູ້ໃຊ້ຍັງມີການຈອງທີ່ອະນຸມັດຢູ່ເວລາເກົ່າ)
        if (booking.pendingStartAt && booking.pendingEndAt) {
            const saved = await this.bookingModel
                .findOneAndUpdate(
                    {
                        $expr: { $eq: [{ $toString: '$_id' }, id] },
                        pendingStartAt: { $ne: null },
                    },
                    {
                        $set: { rescheduleRejectionReason: dto.reason },
                        $unset: { pendingStartAt: '', pendingEndAt: '', pendingRequestedAt: '' },
                        $push: {
                            history: this.historyEvent('RESCHEDULE_REJECTED', {
                                fromStartAt: booking.startAt,
                                fromEndAt: booking.endAt,
                                toStartAt: booking.pendingStartAt,
                                toEndAt: booking.pendingEndAt,
                                actorId: approverId,
                                note: dto.reason,
                            }),
                        },
                    },
                    { new: true },
                )
                .exec();
            if (!saved) {
                await this.findOne(id);
                throw new BadRequestException('This booking has no pending reschedule');
            }
            this.roomBookingsGateway.emitBookingsChanged(saved.roomId.toString());
            return saved;
        }

        const saved = await this.reviewPending(
            id,
            {
                status: BookingStatus.REJECTED,
                reviewedBy: approverId,
                reviewedAt: new Date(),
                rejectionReason: dto.reason,
            },
            { history: this.historyEvent('REJECTED', { actorId: approverId, note: dto.reason }) },
        );
        this.roomBookingsGateway.emitBookingsChanged(saved.roomId.toString());
        return saved;
    }

    async reschedule(id: string, dto: RescheduleRoomBookingDto, requesterId: string) {
        const booking = await this.findOne(id);
        if (booking.bookedBy.toString() !== requesterId) {
            throw new BadRequestException('You can only reschedule your own bookings');
        }
        // ຫ້າມເລື່ອນເວລາ booking ທີ່ຢຸດຕິດແລ້ວ (ຍົກເລີກ/ຖືກປະຕິເສດ) — ບໍ່ດັ່ງນັ້ນມັນຈະຖືກຟື້ນຄືນເປັນ PENDING
        if (booking.status === BookingStatus.CANCELLED || booking.status === BookingStatus.REJECTED) {
            throw new BadRequestException('This booking is no longer active and cannot be rescheduled');
        }
        // ຖ້າເວລາສິ້ນສຸດຂອງປະຊຸມຜ່ານໄປແລ້ວ (ປະຊຸມຈົບແລ້ວ) ກໍບໍ່ອະນຸຍາດໃຫ້ເລື່ອນເວລາ
        if (booking.endAt.getTime() <= Date.now()) {
            throw new BadRequestException('This meeting has already ended and cannot be rescheduled');
        }
        const room = await this.roomsService.findOne(booking.roomId);
        this.assertRoomBookable(room);

        const startAt = new Date(dto.startAt);
        const endAt = new Date(dto.endAt);

        return this.withRoomLock(booking.roomId.toString(), async () => {
            await this.assertNoOverlap(booking.roomId.toString(), startAt, endAt, id);

            // ຖ້າຍັງເປັນຄຳຮ້ອງຈອງໃໝ່ທີ່ຍັງບໍ່ອະນຸມັດ (PENDING) — ຍັງບໍ່ມີເວລາທີ່ອະນຸມັດແລ້ວໃຫ້ປົກປ້ອງ
            // ຈຶ່ງແກ້ເວລາໃນຄຳຮ້ອງໄດ້ເລີຍ (status ຍັງ PENDING ຄືເກົ່າ)
            // ຖ້າອະນຸມັດແລ້ວ (CONFIRMED/legacy) — ຕ້ອງເກັບເວລາເດີມໄວ້ ແລະ ຝາກ "ຄຳຮ້ອງເລື່ອນເວລາ" ໄວ້ລໍຖ້າອະນຸມັດ
            // ໂດຍບໍ່ໄປກະທົບ startAt/endAt ຂອງການຈອງທີ່ອະນຸມັດແລ້ວ — ຖ້າປະຕິເສດ ຈະລຶບພຽງຄຳຮ້ອງນີ້ອອກ
            // ໃຊ້ findOneAndUpdate ຜ່ານ $toString(_id) ເພື່ອຮອງຮັບ legacy booking ທີ່ _id ເປັນ ObjectId (ຄືກັບ reviewPending)
            const isPendingNewRequest = booking.status === BookingStatus.PENDING;
            const saved = await this.bookingModel
                .findOneAndUpdate(
                    { $expr: { $eq: [{ $toString: '$_id' }, id] } },
                    isPendingNewRequest
                        ? {
                            $set: { startAt, endAt },
                            $push: {
                                history: this.historyEvent('REQUEST_UPDATED', {
                                    fromStartAt: booking.startAt,
                                    fromEndAt: booking.endAt,
                                    toStartAt: startAt,
                                    toEndAt: endAt,
                                    actorId: requesterId,
                                }),
                            },
                        }
                        : {
                            $set: {
                                pendingStartAt: startAt,
                                pendingEndAt: endAt,
                                pendingRequestedAt: new Date(),
                            },
                            $unset: { rescheduleRejectionReason: '' },
                            $push: {
                                // ຖ້າມີຄຳຮ້ອງຄ້າງຢູ່ແລ້ວ (ແກ້ໄຂຄຳຮ້ອງ) ບັນທຶກເປັນ "ແກ້ໄຂ"; ບໍ່ດັ່ງນັ້ນເປັນ "ຂໍເລື່ອນເວລາ" ໃໝ່
                                history: this.historyEvent(
                                    booking.pendingStartAt && booking.pendingEndAt
                                        ? 'REQUEST_UPDATED'
                                        : 'RESCHEDULE_REQUESTED',
                                    {
                                        fromStartAt: booking.startAt,
                                        fromEndAt: booking.endAt,
                                        toStartAt: startAt,
                                        toEndAt: endAt,
                                        actorId: requesterId,
                                    },
                                ),
                            },
                        },
                    { new: true },
                )
                .exec();
            if (!saved) {
                throw new BadRequestException('Booking not found');
            }

            this.roomBookingsGateway.emitBookingsChanged(saved.roomId.toString());
            return saved;
        });
    }

    async cancel(id: string, requesterId: string) {
        const booking = await this.findOne(id);
        if (booking.bookedBy.toString() !== requesterId) {
            throw new BadRequestException('You can only cancel your own bookings');
        }
        // ປະຊຸມທີ່ເວລາສິ້ນສຸດຜ່ານໄປແລ້ວ ຍົກເລີກບໍ່ໄດ້ (ເຂົ້າຫ້ອງກໍບໍ່ໄດ້ແລ້ວ ຈຶ່ງບໍ່ມີຄວາມໝາຍທີ່ຈະຍົກເລີກ)
        if (booking.endAt.getTime() <= Date.now()) {
            throw new BadRequestException('This meeting has already ended and cannot be cancelled');
        }

        // ຍົກເລີກແລ້ວກໍລຶບຄຳຮ້ອງເລື່ອນເວລາທີ່ຄ້າງຢູ່ນຳ (ຖ້າມີ) ເພື່ອບໍ່ໃຫ້ເຫຼືອຂໍ້ມູນຄ້າງ
        const saved = await this.bookingModel
            .findOneAndUpdate(
                { $expr: { $eq: [{ $toString: '$_id' }, id] } },
                {
                    $set: { status: BookingStatus.CANCELLED },
                    $unset: { pendingStartAt: '', pendingEndAt: '', pendingRequestedAt: '' },
                    $push: { history: this.historyEvent('CANCELLED', { actorId: requesterId }) },
                },
                { new: true },
            )
            .exec();
        if (!saved) throw new NotFoundException('Booking not found');
        this.roomBookingsGateway.emitBookingsChanged(saved.roomId.toString());
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
            (b) =>
                (b.status === BookingStatus.CONFIRMED || b.status === BookingStatus.PENDING) &&
                b.endAt.getTime() > Date.now(),
        );
        if (cancellable.length > 0) {
            await this.bookingModel
                .updateMany(
                    {
                        seriesId,
                        status: { $in: [BookingStatus.CONFIRMED, BookingStatus.PENDING] },
                        // ບໍ່ຍົກເລີກຄັ້ງທີ່ເວລາຜ່ານໄປແລ້ວ
                        endAt: { $gt: new Date() },
                    },
                    {
                        $set: { status: BookingStatus.CANCELLED },
                        $unset: { pendingStartAt: '', pendingEndAt: '', pendingRequestedAt: '' },
                        $push: { history: this.historyEvent('CANCELLED', { actorId: requesterId }) },
                    },
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
        if (!Array.isArray(booking.history)) booking.history = [];
        booking.history.push(this.historyEvent('CHECKED_IN', { actorId: requesterId }));
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
        if (!Array.isArray(booking.history)) booking.history = [];
        booking.history.push(this.historyEvent('CHECKED_OUT', { actorId: requesterId }));
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
        // ພຽງແຕ່ການຈອງທີ່ຖືກອະນຸມັດກ່ອນເວລາຈອງເລີ່ມ ເທົ່ານັ້ນທີ່ຖືວ່າ "no-show" ເມື່ອບໍ່ check-in —
        // ຖ້າອະນຸມັດຫຼັງເວລາເລີ່ມ (ເຊັ່ນ ຈອງ/ອະນຸມັດຊ້າ) ຈະບໍ່ຍົກເລີກອັດຕະໂນມັດ ເພື່ອໃຫ້ຄົນທີ່ມາໃຊ້ຫ້ອງຍັງ check-in ໄດ້
        filter.$expr = {
            $lte: [{ $ifNull: ['$reviewedAt', '$startAt'] }, '$startAt'],
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
                $push: {
                    history: this.historyEvent('NO_SHOW', {
                        note: `ຍົກເລີກອັດຕະໂນມັດ: ບໍ່ໄດ້ check-in ພາຍໃນ ${NO_SHOW_GRACE_MINUTES} ນາທີ (no-show)`,
                    }),
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