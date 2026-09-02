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

@Injectable()
export class RoomsService {
    constructor(
        @InjectModel(Room.name) private roomModel: Model<RoomDocument>,
        @Inject(forwardRef(() => RoomBookingsService))
        private roomBookingsService: RoomBookingsService,
    ) { }

    // Finds the SMALLEST unused number, not just "last + 1" — so deleting R006 and
    // creating a new room reuses R006 instead of jumping to R00(last+1).
    // Note: this scans all room IDs on every create, so it's fine at hundreds of rooms
    // but isn't the right approach if this collection ever grows into the tens of thousands.
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
        return new this.roomModel({ _id, ...dto }).save();
    }

    findAll(branchId?: string) {
        const filter = branchId ? { branchId } : {};
        return this.roomModel.find(filter).exec();
    }

    async findOne(id: string) {
        const room = await this.roomModel.findById(id).exec();
        if (!room) throw new NotFoundException('Room not found');
        return room;
    }

    // "Live" status = admin flag (Maintenance wins outright) OR whether a confirmed
    // booking currently covers "now". Booked is never stored, always derived.
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
        return room;
    }

    // Dedicated endpoint for "disable a room (maintenance)" so it doesn't need a full update payload.
    async setStatus(id: string, status: RoomStatus) {
        const room = await this.roomModel.findByIdAndUpdate(id, { status }, { new: true }).exec();
        if (!room) throw new NotFoundException('Room not found');
        return room;
    }

    async remove(id: string) {
        const result = await this.roomModel.findByIdAndDelete(id).exec();
        if (!result) throw new NotFoundException('Room not found');
        return { deleted: true };
    }

    async utilization(from: Date, to: Date) {
        return this.roomBookingsService.utilizationReport(from, to);
    }
}