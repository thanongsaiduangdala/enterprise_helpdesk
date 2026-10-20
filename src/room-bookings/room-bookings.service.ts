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
import {
  RoomBookingLock,
  RoomBookingLockDocument,
} from './schemas/room-booking-lock.schema';
import { CreateRoomBookingDto } from './dto/create-room-booking.dto';
import { RescheduleRoomBookingDto } from './dto/reschedule-room-booking.dto';
import { RejectRoomBookingDto } from './dto/reject-room-booking.dto';
import { RecordAttendeesDto } from './dto/record-attendees.dto';
import { RoomsService } from '../rooms/rooms.service';
import { RoomDocument, RoomStatus } from '../rooms/schemas/room.schema';
import { RoomBookingsGateway } from './room-bookings.gateway';
import { RequestBookingChangeDto } from './dto/request-booking-change.dto';
import { NotificationsService } from '../notifications/notifications.service';

const MAX_RECURRING_OCCURRENCES = 60;

const NO_SHOW_GRACE_MINUTES = 15;

const EARLY_CHECKIN_GRACE_MINUTES = 5;

const spanStillCovers = (from: Date) => ({
  $or: [
    { checkedOutAt: null, endAt: { $gt: from } },
    {
      checkedOutAt: { $gt: from },
      $expr: { $gt: ['$checkedOutAt', '$startAt'] },
    },
  ],
});

export interface BookingConflictRef {
  _id: string;
  title?: string;
  startAt: Date;
  endAt: Date;
  bookedBy: { firstName?: string; lastName?: string; email?: string } | null;
}

export type PendingApprovalView = Record<string, any> & {
  conflictWith: BookingConflictRef[];
  blockedBy: BookingConflictRef[];
};

@Injectable()
export class RoomBookingsService {
  constructor(
    @InjectModel(RoomBooking.name)
    private bookingModel: Model<RoomBookingDocument>,
    @InjectModel(RoomBookingLock.name)
    private lockModel: Model<RoomBookingLockDocument>,
    @Inject(forwardRef(() => RoomsService)) private roomsService: RoomsService,
    private roomBookingsGateway: RoomBookingsGateway,
    private notificationsService: NotificationsService,
  ) {}

  private async generateId(): Promise<string> {
    const bookings = await this.bookingModel
      .find({ _id: /^RB\d{3}$/ }, { _id: 1 })
      .sort({ _id: 1 })
      .exec();
    const usedNumbers = new Set(
      bookings.map((b) => parseInt(b._id.slice(2), 10)),
    );
    let seq = 1;
    while (usedNumbers.has(seq)) seq++;
    return `RB${String(seq).padStart(3, '0')}`;
  }

  private async generateIdBatch(count: number): Promise<string[]> {
    const bookings = await this.bookingModel
      .find({ _id: /^RB\d{3}$/ }, { _id: 1 })
      .exec();
    const usedNumbers = new Set(
      bookings.map((b) => parseInt(b._id.slice(2), 10)),
    );
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
      ...spanStillCovers(startAt),
    };
    if (excludeBookingId) {
      filter._id = { $ne: excludeBookingId };
    }
    const clash = await this.bookingModel.findOne(filter).exec();
    if (clash) {
      throw new ConflictException(
        'This room is already booked for the requested time slot',
      );
    }
    const maintenance = await this.roomsService.findMaintenanceOverlapping(
      roomId,
      startAt,
      endAt,
    );
    if (maintenance) {
      throw new ConflictException(
        'This room is closed for maintenance during the requested time slot',
      );
    }
  }

  private assertRoomBookable(room: RoomDocument) {
    if (room.status === RoomStatus.MAINTENANCE) {
      throw new BadRequestException(
        'This room is currently under maintenance and cannot be booked',
      );
    }
    if (!room.isActive) {
      throw new BadRequestException(
        'This room is not currently available for booking',
      );
    }
  }

  private async withRoomLock<T>(
    roomId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
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

    throw new ConflictException(
      'This room is busy processing another booking request — please try again',
    );
  }

  private historyEvent(
    action: string,
    extra: Record<string, any> = {},
  ): RoomBookingHistoryEntry {
    return { action, at: new Date(), ...extra };
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
          changeFlexibility: dto.changeFlexibility ?? 'BOTH',
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
          occurrences.push({
            startAt: new Date(cursor),
            endAt: new Date(cursor.getTime() + durationMs),
          });
          cursor = new Date(cursor.getTime() + stepDays * 24 * 60 * 60 * 1000);
        }

        if (occurrences.length > MAX_RECURRING_OCCURRENCES) {
          throw new BadRequestException(
            `This recurrence would create ${occurrences.length} bookings, over the limit of ${MAX_RECURRING_OCCURRENCES}. Choose a shorter "until" date.`,
          );
        }

        await Promise.all(
          occurrences.map((occ) =>
            this.assertNoOverlap(dto.roomId, occ.startAt, occ.endAt),
          ),
        );

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
          changeFlexibility: dto.changeFlexibility ?? 'BOTH',
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
      rows = parse(fileBuffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      });
    } catch (err: any) {
      throw new ConflictException(`Could not parse CSV file: ${err.message}`);
    }

    const results: Array<{
      row: number;
      reference: string;
      success: boolean;
      error?: string;
    }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2;
      try {
        if (!row.title || !row.roomId || !row.startAt || !row.endAt) {
          throw new Error(
            'Missing one or more required fields (title, roomId, startAt, endAt)',
          );
        }
        if (Number.isNaN(new Date(row.startAt).getTime())) {
          throw new Error(
            'startAt must be a valid date (e.g. 2026-09-22T09:00:00.000Z)',
          );
        }
        if (Number.isNaN(new Date(row.endAt).getTime())) {
          throw new Error(
            'endAt must be a valid date (e.g. 2026-09-22T10:00:00.000Z)',
          );
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
        results.push({
          row: rowNumber,
          reference: row.title ?? '',
          success: false,
          error: error.message ?? 'Unknown error',
        });
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
    return (
      this.bookingModel
        .find({ bookedBy: userId })
        .populate('roomId')

        .populate({
          path: 'history.actorId',
          select: 'firstName lastName email',
        })
        .sort({ startAt: -1 })
        .exec()
    );
  }

  async findForRoom(from: Date, to: Date, roomId?: string, viewerId?: string) {
    const filter: any = {
      status: BookingStatus.CONFIRMED,
      startAt: { $lt: to },

      ...spanStillCovers(from),
    };
    if (roomId) filter.roomId = roomId;

    const found = await this.bookingModel
      .find(filter)
      .select('-history')
      .populate('bookedBy', 'firstName lastName email')
      .sort({ startAt: 1 })
      .exec();

    const bookings: Record<string, any>[] = found.map((booking) => {
      const plain: Record<string, any> = booking.toObject();
      if (
        plain.checkedOutAt &&
        new Date(plain.checkedOutAt).getTime() < new Date(plain.endAt).getTime()
      ) {
        plain.endAt = plain.checkedOutAt;
      }
      return plain;
    });

    if (!viewerId) return bookings;

    return bookings.map((booking) => {
      const bookedBy: any = booking.bookedBy;
      const ownerId =
        bookedBy && typeof bookedBy === 'object'
          ? String(bookedBy._id ?? '')
          : String(bookedBy ?? '');
      if (ownerId === viewerId) return booking;
      const redacted: Record<string, any> = { ...booking };
      redacted.bookedBy = null;
      redacted.reviewedBy = null;
      redacted.attendees = [];
      return redacted;
    });
  }

  async findOne(id: string) {

    const booking = await this.bookingModel
      .findOne({ $expr: { $eq: [{ $toString: '$_id' }, id] } })
      .exec();
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  async findPendingApprovals(): Promise<PendingApprovalView[]> {

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
      .populate('pendingRoomId')
      .populate('bookedBy')
      .sort({ pendingRequestedAt: 1 })
      .exec();

    if (newRequests.length === 0 && reschedules.length === 0) return [];

    const items = [
      ...newRequests.map((doc) => ({
        doc,
        startAt: doc.startAt,
        endAt: doc.endAt,
        isReschedule: false,
        effectiveRoom: doc.roomId as any,
        originalStartAt: null as Date | null,
        originalEndAt: null as Date | null,
      })),
      ...reschedules.map((doc) => ({
        doc,
        startAt: doc.pendingStartAt as Date,
        endAt: doc.pendingEndAt as Date,
        isReschedule: true,
        effectiveRoom: ((doc as any).pendingRoomId || doc.roomId) as any,
        originalStartAt: doc.startAt,
        originalEndAt: doc.endAt,
      })),
    ];

    items.sort((a, b) => {
      const aTime = a.isReschedule
        ? (a.doc.pendingRequestedAt ?? (a.doc as any).createdAt)
        : (a.doc as any).createdAt;
      const bTime = b.isReschedule
        ? (b.doc.pendingRequestedAt ?? (b.doc as any).createdAt)
        : (b.doc as any).createdAt;
      return new Date(aTime).getTime() - new Date(bTime).getTime();
    });

    const minStart = new Date(
      Math.min(...items.map((p) => p.startAt.getTime())),
    );
    const maxEnd = new Date(Math.max(...items.map((p) => p.endAt.getTime())));
    const confirmed = await this.bookingModel
      .find({
        status: BookingStatus.CONFIRMED,
        startAt: { $lt: maxEnd },
        endAt: { $gt: minStart },
      })
      .populate('bookedBy')
      .exec();

    const roomKey = (roomId: any) => String(roomId?._id ?? roomId ?? '');

    const overlaps = (a: any, b: any) =>
      a.startAt < b.endAt && b.startAt < a.endAt;

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
      const room = roomKey(item.effectiveRoom);
      const selfId = booking._id.toString();
      const selfRange = { startAt: item.startAt, endAt: item.endAt };

      const conflictWith = items.filter(
        (other) =>
          other.doc._id.toString() !== selfId &&
          roomKey(other.effectiveRoom) === room &&
          overlaps(selfRange, { startAt: other.startAt, endAt: other.endAt }),
      );

      const blockedBy = confirmed.filter(
        (other) =>
          roomKey(other.roomId) === room &&
          other._id.toString() !== selfId &&
          overlaps(selfRange, other),
      );

      return {
        ...booking.toObject(),

        roomId: item.effectiveRoom,
        originalRoomId: booking.roomId,
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

    if (booking.pendingStartAt && booking.pendingEndAt) {
      const targetRoomId = (
        booking.pendingRoomId || booking.roomId
      ).toString();
      if (targetRoomId !== booking.roomId.toString()) {
        this.assertRoomBookable(await this.roomsService.findOne(targetRoomId));
      }
      await this.assertNoOverlap(
        targetRoomId,
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
              roomId: targetRoomId,
              startAt: booking.pendingStartAt,
              endAt: booking.pendingEndAt,
              reviewedBy: approverId,
              reviewedAt: new Date(),
            },
            $unset: {
              pendingStartAt: '',
              pendingEndAt: '',
              pendingRequestedAt: '',
              pendingRoomId: '',
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
      if (booking.roomId.toString() !== saved.roomId.toString()) {
        this.roomBookingsGateway.emitBookingsChanged(booking.roomId.toString());
      }
      return saved;
    }

    if (booking.status !== BookingStatus.PENDING) {
      throw new BadRequestException('This booking is not waiting for approval');
    }

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

  private async reviewPending(
    id: string,
    set: Record<string, any>,
    push?: Record<string, any>,
  ) {
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

      await this.findOne(id);
      throw new BadRequestException('This booking is not waiting for approval');
    }
    return updated;
  }

  async reject(id: string, approverId: string, dto: RejectRoomBookingDto) {
    const booking = await this.findOne(id);

    if (booking.pendingStartAt && booking.pendingEndAt) {
      const saved = await this.bookingModel
        .findOneAndUpdate(
          {
            $expr: { $eq: [{ $toString: '$_id' }, id] },
            pendingStartAt: { $ne: null },
          },
          {
            $set: { rescheduleRejectionReason: dto.reason },
            $unset: {
              pendingStartAt: '',
              pendingEndAt: '',
              pendingRequestedAt: '',
              pendingRoomId: '',
            },
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
      {
        history: this.historyEvent('REJECTED', {
          actorId: approverId,
          note: dto.reason,
        }),
      },
    );
    this.roomBookingsGateway.emitBookingsChanged(saved.roomId.toString());
    return saved;
  }

  async reschedule(
    id: string,
    dto: RescheduleRoomBookingDto,
    requesterId: string,
  ) {
    const booking = await this.findOne(id);
    if (booking.bookedBy.toString() !== requesterId) {
      throw new BadRequestException(
        'You can only reschedule your own bookings',
      );
    }

    if (
      booking.status === BookingStatus.CANCELLED ||
      booking.status === BookingStatus.REJECTED
    ) {
      throw new BadRequestException(
        'This booking is no longer active and cannot be rescheduled',
      );
    }

    if (booking.checkedOutAt) {
      throw new BadRequestException(
        'This meeting has already been checked out — please make a new booking',
      );
    }

    if (booking.endAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        'This meeting has already ended and cannot be rescheduled',
      );
    }
    const targetRoomId = dto.roomId || booking.roomId.toString();
    const roomChanged = targetRoomId !== booking.roomId.toString();
    const room = await this.roomsService.findOne(targetRoomId);
    this.assertRoomBookable(room);

    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);

    return this.withRoomLock(targetRoomId, async () => {
      await this.assertNoOverlap(targetRoomId, startAt, endAt, id);

      const isPendingNewRequest = booking.status === BookingStatus.PENDING;
      const saved = await this.bookingModel
        .findOneAndUpdate(
          { $expr: { $eq: [{ $toString: '$_id' }, id] } },
          isPendingNewRequest
            ? {
                $set: { startAt, endAt, roomId: targetRoomId },
                $unset: {
                  changeRequestType: '',
                  changeRequestMessage: '',
                  changeRequestedAt: '',
                  changeRequestedBy: '',
                  changeConflicts: '',
                  changeSuggestedRoomId: '',
                  changeSuggestedStartAt: '',
                  changeSuggestedEndAt: '',
                },
                $push: {
                  history: this.historyEvent('REQUEST_UPDATED', {
                    fromStartAt: booking.startAt,
                    fromEndAt: booking.endAt,
                    toStartAt: startAt,
                    toEndAt: endAt,
                    actorId: requesterId,
                    ...(roomChanged
                      ? { note: `ປ່ຽນຫ້ອງ: ${booking.roomId} → ${targetRoomId}` }
                      : {}),
                  }),
                },
              }
            : {
                $set: {
                  pendingStartAt: startAt,
                  pendingEndAt: endAt,
                  pendingRequestedAt: new Date(),
                  ...(roomChanged ? { pendingRoomId: targetRoomId } : {}),
                },
                $unset: {
                  ...(roomChanged ? {} : { pendingRoomId: '' }),
                  rescheduleRejectionReason: '',
                  changeRequestType: '',
                  changeRequestMessage: '',
                  changeRequestedAt: '',
                  changeRequestedBy: '',
                  changeConflicts: '',
                  changeSuggestedRoomId: '',
                  changeSuggestedStartAt: '',
                  changeSuggestedEndAt: '',
                },
                $push: {

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
                      ...(roomChanged
                        ? {
                            note: `ປ່ຽນຫ້ອງ: ${booking.roomId} → ${targetRoomId}`,
                          }
                        : {}),
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
      if (roomChanged) {
        this.roomBookingsGateway.emitBookingsChanged(targetRoomId);
        this.roomBookingsGateway.emitBookingsChanged(booking.roomId.toString());
      }
      return saved;
    });
  }

  // ຜູ້ອະນຸມັດຂໍໃຫ້ຜູ້ຈອງ "ປ່ຽນເວລາ ຫຼື ປ່ຽນຫ້ອງ" ເພາະຕາຕະລາງຊົ່ວກັບການຈອງອື່ນ.
  // ບໍ່ປະຕິເສດການຈອງ — ຄຳຮ້ອງຍັງລໍຖ້າຢູ່ ຈົນກວ່າຜູ້ຈອງຈະສົ່ງເວລາໃໝ່ ຫຼື ຍົກເລີກແລ້ວຈອງຫ້ອງອື່ນ
  async requestChange(
    id: string,
    approverId: string,
    dto: RequestBookingChangeDto,
  ) {
    const booking = await this.findOne(id);
    const hasPendingReschedule = !!(
      booking.pendingStartAt && booking.pendingEndAt
    );
    if (
      booking.status === BookingStatus.CANCELLED ||
      booking.status === BookingStatus.REJECTED ||
      (booking.status !== BookingStatus.PENDING && !hasPendingReschedule)
    ) {
      throw new BadRequestException(
        'This booking is not waiting for approval, so a change cannot be requested',
      );
    }

    const now = new Date();

    // ຊອກຫາການຈອງ (ອະນຸມັດແລ້ວ ຫຼື ລໍຖ້າ) ທີ່ຊົ່ວກັບເວລາ/ຫ້ອງທີ່ກຳລັງຂໍ
    const effStart = hasPendingReschedule
      ? (booking.pendingStartAt as Date)
      : booking.startAt;
    const effEnd = hasPendingReschedule
      ? (booking.pendingEndAt as Date)
      : booking.endAt;
    const effRoom = (
      hasPendingReschedule && booking.pendingRoomId
        ? booking.pendingRoomId
        : booking.roomId
    ).toString();
    const clashDocs = await this.bookingModel
      .find({
        roomId: effRoom,
        _id: { $ne: booking._id },
        status: { $in: [BookingStatus.CONFIRMED, BookingStatus.PENDING] },
        startAt: { $lt: effEnd },
        endAt: { $gt: effStart },
      })
      .exec();
    const changeConflicts = clashDocs.map((c) => ({
      title: c.title,
      startAt: c.startAt,
      endAt: c.endAt,
    }));

    // ເວລາທີ່ແນະນຳ: ຕ້ອງມາຄູ່ກັນ, ໄລຍະເວລາເທົ່າກັບທີ່ຜູ້ຈອງຂໍມາ, ແລະ ບໍ່ຊົ່ວກັບການຈອງທີ່ອະນຸມັດແລ້ວ/ປິດບຳລຸງ
    let suggestedStart: Date | null = null;
    let suggestedEnd: Date | null = null;
    if (dto.suggestedStartAt || dto.suggestedEndAt) {
      if (!dto.suggestedStartAt || !dto.suggestedEndAt) {
        throw new BadRequestException(
          'suggestedStartAt and suggestedEndAt must be sent together',
        );
      }
      if (dto.type === 'ROOM') {
        throw new BadRequestException(
          'A suggested time can only be sent with a TIME or EITHER change request',
        );
      }
      suggestedStart = new Date(dto.suggestedStartAt);
      suggestedEnd = new Date(dto.suggestedEndAt);
      if (suggestedEnd <= suggestedStart) {
        throw new BadRequestException('Suggested end must be after suggested start');
      }
      const wantedMs = effEnd.getTime() - effStart.getTime();
      const suggestedMs = suggestedEnd.getTime() - suggestedStart.getTime();
      if (Math.abs(wantedMs - suggestedMs) > 1000) {
        throw new BadRequestException(
          'Suggested time must have the same duration as the requested time',
        );
      }
      await this.assertNoOverlap(effRoom, suggestedStart, suggestedEnd, id);
    }
    const hasRoomSuggestion = !!dto.suggestedRoomId && dto.type !== 'TIME';
    const hasTimeSuggestion = !!suggestedStart && !!suggestedEnd;
    const suggestionUnset: Record<string, ''> = {
      ...(hasRoomSuggestion ? {} : { changeSuggestedRoomId: '' }),
      ...(hasTimeSuggestion
        ? {}
        : { changeSuggestedStartAt: '', changeSuggestedEndAt: '' }),
    };

    const saved = await this.bookingModel
      .findOneAndUpdate(
        { $expr: { $eq: [{ $toString: '$_id' }, id] } },
        {
          $set: {
            changeConflicts,
            changeRequestType: dto.type,
            changeRequestMessage: dto.message,
            changeRequestedAt: now,
            changeRequestedBy: approverId,
            ...(hasRoomSuggestion
              ? { changeSuggestedRoomId: dto.suggestedRoomId }
              : {}),
            ...(hasTimeSuggestion
              ? {
                  changeSuggestedStartAt: suggestedStart,
                  changeSuggestedEndAt: suggestedEnd,
                }
              : {}),
          },
          ...(Object.keys(suggestionUnset).length > 0
            ? { $unset: suggestionUnset }
            : {}),
          $push: {
            history: this.historyEvent('CHANGE_REQUESTED', {
              actorId: approverId,
              note: `[${dto.type}] ${dto.message}`,
              ...(hasPendingReschedule
                ? {
                    toStartAt: booking.pendingStartAt,
                    toEndAt: booking.pendingEndAt,
                  }
                : { toStartAt: booking.startAt, toEndAt: booking.endAt }),
            }),
          },
        },
        { new: true },
      )
      .exec();
    if (!saved) throw new NotFoundException('Booking not found');

    const what =
      dto.type === 'TIME'
        ? 'ກະລຸນາປ່ຽນເວລາ'
        : dto.type === 'ROOM'
          ? 'ກະລຸນາປ່ຽນໄປຫ້ອງອື່ນ'
          : 'ກະລຸນາປ່ຽນເວລາ ຫຼື ປ່ຽນຫ້ອງ';
    try {
      await this.notificationsService.notify(
        saved.bookedBy.toString(),
        'ROOM_BOOKING_CHANGE_REQUESTED',
        saved._id.toString(),
        'RoomBooking',
        `ຂໍໃຫ້ແກ້ໄຂການຈອງຫ້ອງ: ${saved.title}`,
        `${what} — ${dto.message}`,
      );
    } catch {
      // the request itself is saved; a failed notification must not undo it
    }

    this.roomBookingsGateway.emitBookingsChanged(saved.roomId.toString());
    return saved;
  }

  async cancel(id: string, requesterId: string) {
    const booking = await this.findOne(id);
    if (booking.bookedBy.toString() !== requesterId) {
      throw new BadRequestException('You can only cancel your own bookings');
    }
    if (booking.checkedOutAt) {
      throw new BadRequestException(
        'This meeting has already been checked out and cannot be cancelled',
      );
    }

    if (booking.endAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        'This meeting has already ended and cannot be cancelled',
      );
    }

    const saved = await this.bookingModel
      .findOneAndUpdate(
        { $expr: { $eq: [{ $toString: '$_id' }, id] } },
        {
          $set: { status: BookingStatus.CANCELLED },
          $unset: {
            pendingStartAt: '',
            pendingEndAt: '',
            pendingRequestedAt: '',
              pendingRoomId: '',
          },
          $push: {
            history: this.historyEvent('CANCELLED', { actorId: requesterId }),
          },
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
        (b.status === BookingStatus.CONFIRMED ||
          b.status === BookingStatus.PENDING) &&
        b.endAt.getTime() > Date.now(),
    );
    if (cancellable.length > 0) {
      await this.bookingModel
        .updateMany(
          {
            seriesId,
            status: { $in: [BookingStatus.CONFIRMED, BookingStatus.PENDING] },

            endAt: { $gt: new Date() },
          },
          {
            $set: { status: BookingStatus.CANCELLED },
            $unset: {
              pendingStartAt: '',
              pendingEndAt: '',
              pendingRequestedAt: '',
              pendingRoomId: '',
            },
            $push: {
              history: this.historyEvent('CANCELLED', { actorId: requesterId }),
            },
          },
        )
        .exec();
      this.roomBookingsGateway.emitBookingsChanged();
    }

    return { seriesId, cancelledCount: cancellable.length };
  }

  async checkIn(id: string, requesterId: string) {
    const booking = await this.findOne(id);
    if (booking.bookedBy.toString() !== requesterId) {
      throw new BadRequestException(
        'You can only check in to your own bookings',
      );
    }
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new BadRequestException(
        'Only confirmed bookings can be checked in',
      );
    }
    if (booking.checkedInAt) {
      throw new BadRequestException('This booking has already been checked in');
    }
    const now = new Date();
    const earliestAllowed = new Date(
      booking.startAt.getTime() - EARLY_CHECKIN_GRACE_MINUTES * 60000,
    );
    if (now < earliestAllowed) {
      throw new BadRequestException(
        `Too early to check in — this booking starts at ${booking.startAt.toISOString()}`,
      );
    }
    if (now >= booking.endAt) {
      throw new BadRequestException('This booking has already ended');
    }
    booking.checkedInAt = now;
    if (!Array.isArray(booking.history)) booking.history = [];
    booking.history.push(
      this.historyEvent('CHECKED_IN', { actorId: requesterId }),
    );
    const saved = await booking.save();
    this.roomBookingsGateway.emitBookingsChanged(booking.roomId.toString());
    return saved;
  }

  async checkOut(id: string, requesterId: string) {
    const booking = await this.findOne(id);
    if (booking.bookedBy.toString() !== requesterId) {
      throw new BadRequestException(
        'You can only check out of your own bookings',
      );
    }
    if (!booking.checkedInAt) {
      throw new BadRequestException('This booking has not been checked in yet');
    }
    if (booking.checkedOutAt) {
      throw new BadRequestException(
        'This booking has already been checked out',
      );
    }
    booking.checkedOutAt = new Date();
    if (!Array.isArray(booking.history)) booking.history = [];
    booking.history.push(
      this.historyEvent('CHECKED_OUT', { actorId: requesterId }),
    );
    const saved = await booking.save();
    this.roomBookingsGateway.emitBookingsChanged(booking.roomId.toString());
    return saved;
  }

  async recordAttendees(
    id: string,
    requesterId: string,
    dto: RecordAttendeesDto,
  ) {
    const booking = await this.findOne(id);
    if (booking.bookedBy.toString() !== requesterId) {
      throw new BadRequestException(
        'You can only record attendees for your own bookings',
      );
    }
    booking.attendees = dto.attendees;
    const saved = await booking.save();
    this.roomBookingsGateway.emitBookingsChanged(booking.roomId.toString());
    return saved;
  }

  private async releaseNoShowBookings(roomIds?: string[]) {
    const cutoff = new Date(Date.now() - NO_SHOW_GRACE_MINUTES * 60000);
    const filter: any = {
      status: BookingStatus.CONFIRMED,
      checkedInAt: null,
      startAt: { $lte: cutoff },
      endAt: { $gt: new Date() },
    };

    filter.$expr = {
      $lte: [{ $ifNull: ['$reviewedAt', '$startAt'] }, '$startAt'],
    };
    if (roomIds && roomIds.length > 0) {
      filter.roomId = { $in: roomIds };
    }
    const result = await this.bookingModel
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

    if (result.modifiedCount > 0) {
      this.roomBookingsGateway.emitBookingsChanged();
    }
  }

  async isRoomBookedAt(roomId: string, at: Date): Promise<boolean> {
    await this.releaseNoShowBookings([roomId]);
    const clash = await this.bookingModel
      .findOne({
        roomId,
        status: BookingStatus.CONFIRMED,
        startAt: { $lte: at },
        endAt: { $gt: at },
        checkedOutAt: null,
      })
      .exec();
    return !!clash;
  }

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

  async findRoomIdsBusyBetween(
    roomIds: string[],
    from: Date,
    to: Date,
  ): Promise<Set<string>> {
    if (roomIds.length === 0) return new Set();
    await this.releaseNoShowBookings(roomIds);
    const clashes = await this.bookingModel
      .find({
        roomId: { $in: roomIds },
        status: BookingStatus.CONFIRMED,
        startAt: { $lt: to },
        ...spanStillCovers(from),
      })
      .select('roomId')
      .exec();
    return new Set(clashes.map((c) => String(c.roomId)));
  }

  async findAffectedByMaintenance(roomId: string, from: Date, to?: Date) {
    const filter: any = {
      roomId,
      status: { $in: [BookingStatus.CONFIRMED, BookingStatus.PENDING] },
      ...spanStillCovers(from),
    };
    if (to) filter.startAt = { $lt: to };
    const found = await this.bookingModel
      .find(filter)
      .select('-history')
      .populate('bookedBy', 'firstName lastName email')
      .sort({ startAt: 1 })
      .exec();
    return found.map((b) => b.toObject());
  }

  async cancelForMaintenance(ids: string[], adminId: string, reason?: string) {
    const note = reason?.trim() || 'ຫ້ອງປິດບຳລຸງ';
    const cancelled: string[] = [];
    const roomIds = new Set<string>();
    for (const id of ids) {
      const saved = await this.bookingModel
        .findOneAndUpdate(
          {
            $expr: { $eq: [{ $toString: '$_id' }, id] },
            status: { $in: [BookingStatus.CONFIRMED, BookingStatus.PENDING] },
          },
          {
            $set: { status: BookingStatus.CANCELLED },
            $unset: {
              pendingStartAt: '',
              pendingEndAt: '',
              pendingRequestedAt: '',
              pendingRoomId: '',
            },
            $push: {
              history: this.historyEvent('CANCELLED', {
                actorId: adminId,
                note,
              }),
            },
          },
          { new: true },
        )
        .exec();
      if (saved) {
        cancelled.push(String(saved._id));
        roomIds.add(String(saved.roomId));
      }
    }
    roomIds.forEach((roomId) =>
      this.roomBookingsGateway.emitBookingsChanged(roomId),
    );
    return { cancelled: cancelled.length, ids: cancelled };
  }

  // ແທນທີ່ຈະຍົກເລີກ: ແຈ້ງຜູ້ຈອງ (ທັງທີ່ອະນຸມັດແລ້ວ ແລະ ລໍຖ້າ) ທີ່ຊົ່ວກັບການປິດບຳລຸງ
  // ໃຫ້ "ປ່ຽນເວລາ / ປ່ຽນຫ້ອງ / ທັງສອງ" ຕາມທີ່ຜູ້ຈອງຕອບໄວ້ຕອນຈອງ (changeFlexibility)
  async requestChangeForMaintenance(
    ids: string[],
    adminId: string,
    reason?: string,
  ) {
    const note = reason?.trim() || 'ຫ້ອງປິດບຳລຸງ';
    const requested: string[] = [];
    const skipped: string[] = [];
    const roomIds = new Set<string>();

    for (const id of ids) {
      const booking = await this.bookingModel
        .findOne({
          $expr: { $eq: [{ $toString: '$_id' }, id] },
          status: { $in: [BookingStatus.CONFIRMED, BookingStatus.PENDING] },
        })
        .exec();
      if (!booking || booking.checkedOutAt) {
        skipped.push(id);
        continue;
      }

      const flex = (booking.changeFlexibility as string) || 'BOTH';
      // TIME -> ຂໍປ່ຽນເວລາ, ROOM -> ຂໍປ່ຽນຫ້ອງ, BOTH/NONE -> ໃຫ້ເລືອກເອງ
      // (NONE: ການປິດບຳລຸງບັງຄັບ ຈຶ່ງຍັງຕ້ອງໃຫ້ຜູ້ຈອງເລືອກເອງ)
      const type: 'TIME' | 'ROOM' | 'EITHER' =
        flex === 'TIME' ? 'TIME' : flex === 'ROOM' ? 'ROOM' : 'EITHER';
      const what =
        type === 'TIME'
          ? 'ກະລຸນາປ່ຽນເວລາ'
          : type === 'ROOM'
            ? 'ກະລຸນາປ່ຽນໄປຫ້ອງອື່ນ'
            : 'ກະລຸນາປ່ຽນເວລາ ຫຼື ປ່ຽນຫ້ອງ';
      const message = `${note} — ${what}`;

      const win = await this.roomsService.findMaintenanceOverlapping(
        booking.roomId.toString(),
        booking.startAt,
        booking.endAt,
      );
      const changeConflicts = [
        {
          title: win?.reason || note,
          startAt: win?.startAt ?? booking.startAt,
          endAt: win?.endAt ?? booking.endAt,
        },
      ];

      const saved = await this.bookingModel
        .findOneAndUpdate(
          { _id: booking._id },
          {
            $set: {
              changeConflicts,
              changeRequestType: type,
              changeRequestMessage: message,
              changeRequestedAt: new Date(),
              changeRequestedBy: adminId,
            },
            $unset: {
              changeSuggestedRoomId: '',
              changeSuggestedStartAt: '',
              changeSuggestedEndAt: '',
            },
            $push: {
              history: this.historyEvent('CHANGE_REQUESTED', {
                actorId: adminId,
                note: `[${type}] ${message}`,
                toStartAt: booking.startAt,
                toEndAt: booking.endAt,
              }),
            },
          },
          { new: true },
        )
        .exec();
      if (!saved) {
        skipped.push(id);
        continue;
      }
      requested.push(String(saved._id));
      roomIds.add(String(saved.roomId));

      try {
        await this.notificationsService.notify(
          saved.bookedBy.toString(),
          'ROOM_BOOKING_CHANGE_REQUESTED',
          saved._id.toString(),
          'RoomBooking',
          `ຂໍໃຫ້ແກ້ໄຂການຈອງຫ້ອງ: ${saved.title}`,
          message,
        );
      } catch {
        // the request itself is saved; a failed notification must not undo it
      }
    }

    roomIds.forEach((roomId) =>
      this.roomBookingsGateway.emitBookingsChanged(roomId),
    );
    return { requested: requested.length, ids: requested, skipped };
  }

  async utilizationReport(from: Date, to: Date) {
    return this.bookingModel.aggregate([
      {
        $match: {
          status: BookingStatus.CONFIRMED,
          startAt: { $lt: to },
          ...spanStillCovers(from),
        },
      },
      {
        $group: {
          _id: '$roomId',

          bookedMinutes: {
            $sum: {
              $divide: [
                {
                  $subtract: [
                    {
                      $min: [
                        '$endAt',
                        { $ifNull: ['$checkedOutAt', '$endAt'] },
                      ],
                    },
                    '$startAt',
                  ],
                },
                60000,
              ],
            },
          },
          bookingCount: { $sum: 1 },
        },
      },
      { $sort: { bookedMinutes: -1 } },
    ]);
  }
}
