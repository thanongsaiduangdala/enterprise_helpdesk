import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { parse } from 'csv-parse/sync';
import { Room, RoomDocument, RoomStatus } from './schemas/room.schema';
import {
  RoomMaintenance,
  RoomMaintenanceDocument,
} from './schemas/room-maintenance.schema';
import { CreateRoomDto } from './dto/create-room.dto';
import { CreateRoomMaintenanceDto } from './dto/create-room-maintenance.dto';
import { UpdateRoomMaintenanceDto } from './dto/update-room-maintenance.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { RoomBookingsService } from '../room-bookings/room-bookings.service';
import { RoomBookingsGateway } from '../room-bookings/room-bookings.gateway';

@Injectable()
export class RoomsService {
  constructor(
    @InjectModel(Room.name) private roomModel: Model<RoomDocument>,
    @InjectModel(RoomMaintenance.name)
    private maintenanceModel: Model<RoomMaintenanceDocument>,
    @Inject(forwardRef(() => RoomBookingsService))
    private roomBookingsService: RoomBookingsService,
    private roomBookingsGateway: RoomBookingsGateway,
  ) {}

  private async generateId(): Promise<string> {
    const rooms = await this.roomModel
      .find({ _id: /^R\d{3}$/ }, { _id: 1 })
      .sort({ _id: 1 })
      .exec();
    const usedNumbers = new Set(rooms.map((r) => parseInt(r._id.slice(1), 10)));
    let seq = 1;
    while (usedNumbers.has(seq)) seq++;
    return `R${String(seq).padStart(3, '0')}`;
  }

  async create(dto: CreateRoomDto) {
    const existing = await this.roomModel.findOne({
      branchId: dto.branchId,
      name: dto.name,
    });
    if (existing) {
      throw new ConflictException(
        `Room "${dto.name}" already exists in this branch`,
      );
    }
    const _id = await this.generateId();
    const room = await new this.roomModel({ _id, ...dto }).save();
    this.roomBookingsGateway.emitRoomsChanged(String(room._id));
    return room;
  }

  async bulkImport(fileBuffer: Buffer) {
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
        if (!row.branchId || !row.name || !row.capacity) {
          throw new Error(
            'Missing one or more required fields (branchId, name, capacity)',
          );
        }
        const capacity = Number(row.capacity);
        if (!Number.isInteger(capacity) || capacity < 1) {
          throw new Error('capacity must be a positive integer');
        }
        const dto: CreateRoomDto = {
          branchId: row.branchId,
          name: row.name,
          floor: row.floor || undefined,
          location: row.location || undefined,
          capacity,
          amenities: row.amenities
            ? row.amenities
                .split(/[;,]+/)
                .map((a: string) => a.trim())
                .filter(Boolean)
            : undefined,
          status: (row.status ? row.status.toUpperCase() : undefined) as any,
          isActive: row.isActive
            ? row.isActive === 'true' || row.isActive === '1'
            : undefined,
        };
        await this.create(dto);
        results.push({ row: rowNumber, reference: row.name, success: true });
      } catch (error: any) {
        results.push({
          row: rowNumber,
          reference: row.name ?? '',
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

  findAll(branchId?: string) {
    const filter = branchId ? { branchId } : {};
    return this.roomModel.find(filter).exec();
  }

  async findAllWithLiveStatus(branchId?: string) {
    const rooms = await this.findAll(branchId);
    const nonMaintenanceIds = rooms
      .filter((r) => r.status !== RoomStatus.MAINTENANCE)
      .map((r) => r._id);
    const now = new Date();
    const bookedNowIds = await this.roomBookingsService.findRoomIdsBookedAt(
      nonMaintenanceIds,
      now,
    );
    const activeWindows = await this.maintenanceModel
      .find({ startAt: { $lte: now }, endAt: { $gt: now } })
      .lean()
      .exec();
    const activeByRoom = new Map<string, any>(
      activeWindows.map((w: any) => [String(w.roomId), w]),
    );

    return rooms.map((room) => {
      const obj = room.toObject();
      if (room.status === RoomStatus.MAINTENANCE) {
        return { ...obj, liveStatus: RoomStatus.MAINTENANCE };
      }
      const activeWindow = activeByRoom.get(String(room._id));
      if (activeWindow) {
        return {
          ...obj,
          liveStatus: RoomStatus.MAINTENANCE,
          activeMaintenance: activeWindow,
        };
      }
      return {
        ...obj,
        liveStatus: bookedNowIds.has(String(room._id))
          ? 'BOOKED'
          : RoomStatus.AVAILABLE,
      };
    });
  }

  async findAvailableBetween(from: Date, to: Date, branchId?: string) {
    if (to <= from) {
      throw new BadRequestException('"to" must be after "from"');
    }
    const rooms = await this.findAll(branchId);
    const candidates = rooms.filter(
      (r) => r.isActive && r.status !== RoomStatus.MAINTENANCE,
    );
    const candidateIds = candidates.map((r) => String(r._id));
    const busyIds = await this.roomBookingsService.findRoomIdsBusyBetween(
      candidateIds,
      from,
      to,
    );
    const maintenanceBusy = await this.maintenanceModel
      .find({
        roomId: { $in: candidateIds },
        startAt: { $lt: to },
        endAt: { $gt: from },
      })
      .select('roomId')
      .lean()
      .exec();
    maintenanceBusy.forEach((m: any) => busyIds.add(String(m.roomId)));
    return candidates
      .filter((r) => !busyIds.has(String(r._id)))
      .map((r) => r.toObject());
  }

  async findOne(id: string) {
    const room = await this.roomModel.findById(id).exec();
    if (!room) throw new NotFoundException('Room not found');
    return room;
  }

  async findOneWithLiveStatus(id: string) {
    const room = await this.findOne(id);
    if (room.status === RoomStatus.MAINTENANCE) {
      return { ...room.toObject(), liveStatus: RoomStatus.MAINTENANCE };
    }
    const now = new Date();
    const activeWindow = await this.maintenanceModel
      .findOne({ roomId: id, startAt: { $lte: now }, endAt: { $gt: now } })
      .lean()
      .exec();
    if (activeWindow) {
      return {
        ...room.toObject(),
        liveStatus: RoomStatus.MAINTENANCE,
        activeMaintenance: activeWindow,
      };
    }
    const isBookedNow = await this.roomBookingsService.isRoomBookedAt(
      id,
      new Date(),
    );
    return {
      ...room.toObject(),
      liveStatus: isBookedNow ? 'BOOKED' : RoomStatus.AVAILABLE,
    };
  }

  async update(id: string, dto: UpdateRoomDto) {
    const room = await this.roomModel
      .findByIdAndUpdate(id, dto, { new: true })
      .exec();
    if (!room) throw new NotFoundException('Room not found');
    this.roomBookingsGateway.emitRoomsChanged(id);
    return room;
  }

  async setStatus(id: string, status: RoomStatus) {
    const room = await this.roomModel
      .findByIdAndUpdate(id, { status }, { new: true })
      .exec();
    if (!room) throw new NotFoundException('Room not found');
    this.roomBookingsGateway.emitRoomsChanged(id);
    return room;
  }

  async remove(id: string) {
    const result = await this.roomModel.findByIdAndDelete(id).exec();
    if (!result) throw new NotFoundException('Room not found');
    await this.maintenanceModel.deleteMany({ roomId: id }).exec();
    this.roomBookingsGateway.emitRoomsChanged(id);
    return { deleted: true };
  }

  async listMaintenance(from?: Date, to?: Date, roomId?: string) {
    const filter: any = {};
    if (roomId) filter.roomId = roomId;
    if (from) filter.endAt = { $gt: from };
    if (to) filter.startAt = { $lt: to };
    return this.maintenanceModel.find(filter).sort({ startAt: 1 }).lean().exec();
  }

  findMaintenanceOverlapping(roomId: string, from: Date, to: Date) {
    return this.maintenanceModel
      .findOne({ roomId, startAt: { $lt: to }, endAt: { $gt: from } })
      .exec();
  }

  maintenanceImpact(roomId: string, from: Date, to?: Date) {
    return this.roomBookingsService.findAffectedByMaintenance(
      roomId,
      from,
      to,
    );
  }

  async affectedByMaintenance() {
    const now = new Date();
    const closedRooms = await this.roomModel
      .find({ status: RoomStatus.MAINTENANCE })
      .select('_id')
      .lean()
      .exec();
    const windows = await this.maintenanceModel
      .find({ endAt: { $gt: now } })
      .lean()
      .exec();

    const queries: { roomId: string; from: Date; to?: Date }[] = [
      ...closedRooms.map((r: any) => ({ roomId: String(r._id), from: now })),
      ...windows.map((w: any) => ({
        roomId: String(w.roomId),
        from: w.startAt > now ? w.startAt : now,
        to: w.endAt,
      })),
    ];
    const results = await Promise.all(
      queries.map((q) =>
        this.roomBookingsService.findAffectedByMaintenance(
          q.roomId,
          q.from,
          q.to,
        ),
      ),
    );
    const byId = new Map<string, any>();
    results.flat().forEach((b: any) => byId.set(String(b._id), b));
    return Array.from(byId.values());
  }

  async createMaintenance(
    roomId: string,
    dto: CreateRoomMaintenanceDto,
    userId: string,
  ) {
    const room = await this.findOne(roomId);
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (endAt <= startAt) {
      throw new BadRequestException('endAt must be after startAt');
    }
    if (endAt.getTime() <= Date.now()) {
      throw new BadRequestException('The maintenance period has already ended');
    }
    const created = await this.maintenanceModel.create({
      roomId: String(room._id),
      startAt,
      endAt,
      reason: dto.reason?.trim() || undefined,
      createdBy: userId,
    });
    this.roomBookingsGateway.emitRoomsChanged(roomId);
    this.roomBookingsGateway.emitBookingsChanged(roomId);
    return created.toObject();
  }

  async updateMaintenance(windowId: string, dto: UpdateRoomMaintenanceDto) {
    if (!Types.ObjectId.isValid(windowId)) {
      throw new NotFoundException('Maintenance period not found');
    }
    const existing = await this.maintenanceModel.findById(windowId).exec();
    if (!existing) throw new NotFoundException('Maintenance period not found');

    const startAt = dto.startAt ? new Date(dto.startAt) : existing.startAt;
    const endAt = dto.endAt ? new Date(dto.endAt) : existing.endAt;
    if (endAt <= startAt) {
      throw new BadRequestException('endAt must be after startAt');
    }
    if (endAt.getTime() <= Date.now()) {
      throw new BadRequestException('The maintenance period has already ended');
    }

    existing.startAt = startAt;
    existing.endAt = endAt;
    if (dto.reason !== undefined) {
      existing.reason = dto.reason.trim() || undefined;
    }
    await existing.save();

    this.roomBookingsGateway.emitRoomsChanged(String(existing.roomId));
    this.roomBookingsGateway.emitBookingsChanged(String(existing.roomId));
    return existing.toObject();
  }

  async removeMaintenance(windowId: string) {
    if (!Types.ObjectId.isValid(windowId)) {
      throw new NotFoundException('Maintenance period not found');
    }
    const removed = await this.maintenanceModel
      .findByIdAndDelete(windowId)
      .exec();
    if (!removed) throw new NotFoundException('Maintenance period not found');
    this.roomBookingsGateway.emitRoomsChanged(String(removed.roomId));
    this.roomBookingsGateway.emitBookingsChanged(String(removed.roomId));
    return { deleted: true };
  }

  async utilization(from: Date, to: Date) {
    return this.roomBookingsService.utilizationReport(from, to);
  }
}
