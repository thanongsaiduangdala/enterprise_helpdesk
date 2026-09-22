import {
    ConflictException,
    forwardRef,
    Inject,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { parse } from 'csv-parse/sync';
import { Room, RoomDocument, RoomStatus } from './schemas/room.schema';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { RoomBookingsService } from '../room-bookings/room-bookings.service';
import { RoomBookingsGateway } from '../room-bookings/room-bookings.gateway';

@Injectable()
export class RoomsService {
    constructor(
        @InjectModel(Room.name) private roomModel: Model<RoomDocument>,
        @Inject(forwardRef(() => RoomBookingsService))
        private roomBookingsService: RoomBookingsService,
        private roomBookingsGateway: RoomBookingsGateway,
    ) { }





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
        const existing = await this.roomModel.findOne({ branchId: dto.branchId, name: dto.name });
        if (existing) {
            throw new ConflictException(`Room "${dto.name}" already exists in this branch`);
        }
        const _id = await this.generateId();
        const room = await new this.roomModel({ _id, ...dto }).save();
        this.roomBookingsGateway.emitRoomsChanged(String(room._id));
        return room;
    }

    async bulkImport(fileBuffer: Buffer) {
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
                if (!row.branchId || !row.name || !row.capacity) {
                    throw new Error('Missing one or more required fields (branchId, name, capacity)');
                }
                const capacity = Number(row.capacity);
                if (!Number.isInteger(capacity) || capacity < 1) {
                    throw new Error('capacity must be a positive integer');
                }
                const dto: CreateRoomDto = {
                    branchId: row.branchId,
                    name: row.name,
                    location: row.location || undefined,
                    capacity,
                    amenities: row.amenities ? row.amenities.split(/[;,]+/).map((a: string) => a.trim()).filter(Boolean) : undefined,
                    status: (row.status ? row.status.toUpperCase() : undefined) as any,
                    isActive: row.isActive ? row.isActive === 'true' || row.isActive === '1' : undefined,
                };
                await this.create(dto);
                results.push({ row: rowNumber, reference: row.name, success: true });
            } catch (error: any) {
                results.push({ row: rowNumber, reference: row.name ?? '', success: false, error: error.message ?? 'Unknown error' });
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

    // ຄືກັນກັບ findAll() ແຕ່ຕິດຄ່າ liveStatus (AVAILABLE / BOOKED / MAINTENANCE) ໃຫ້ແຕ່ລະຫ້ອງ —
    // ໃຊ້ໂດຍ GET /rooms ເພື່ອໃຫ້ໜ້າລາຍຊື່ຫ້ອງ (card grid + widget ໜ້າ dashboard) ເຫັນສະຖານະ "ກຳລັງໃຊ້ງານ" ໄດ້ຄືກັບ findOneWithLiveStatus()
    async findAllWithLiveStatus(branchId?: string) {
        const rooms = await this.findAll(branchId);
        const nonMaintenanceIds = rooms
            .filter((r) => r.status !== RoomStatus.MAINTENANCE)
            .map((r) => r._id);
        const bookedNowIds = await this.roomBookingsService.findRoomIdsBookedAt(nonMaintenanceIds, new Date());

        return rooms.map((room) => {
            const obj = room.toObject();
            if (room.status === RoomStatus.MAINTENANCE) {
                return { ...obj, liveStatus: RoomStatus.MAINTENANCE };
            }
            return { ...obj, liveStatus: bookedNowIds.has(String(room._id)) ? 'BOOKED' : RoomStatus.AVAILABLE };
        });
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
        const isBookedNow = await this.roomBookingsService.isRoomBookedAt(id, new Date());
        return { ...room.toObject(), liveStatus: isBookedNow ? 'BOOKED' : RoomStatus.AVAILABLE };
    }

    async update(id: string, dto: UpdateRoomDto) {
        const room = await this.roomModel.findByIdAndUpdate(id, dto, { new: true }).exec();
        if (!room) throw new NotFoundException('Room not found');
        this.roomBookingsGateway.emitRoomsChanged(id);
        return room;
    }


    async setStatus(id: string, status: RoomStatus) {
        const room = await this.roomModel.findByIdAndUpdate(id, { status }, { new: true }).exec();
        if (!room) throw new NotFoundException('Room not found');
        this.roomBookingsGateway.emitRoomsChanged(id);
        return room;
    }

    async remove(id: string) {
        const result = await this.roomModel.findByIdAndDelete(id).exec();
        if (!result) throw new NotFoundException('Room not found');
        this.roomBookingsGateway.emitRoomsChanged(id);
        return { deleted: true };
    }

    async utilization(from: Date, to: Date) {
        return this.roomBookingsService.utilizationReport(from, to);
    }
}