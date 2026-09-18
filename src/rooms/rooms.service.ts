import {
    ConflictException,
    forwardRef,
    Inject,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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