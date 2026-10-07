import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, UpdateQuery } from 'mongoose';
import {
  MaintenanceHistory,
  MaintenanceHistoryDocument,
  MaintenanceStatus,
} from './schemas/maintenance-history.schema';
import { CreateMaintenanceRecordDto } from './dto/create-maintenance-record.dto';
import { UpdateMaintenanceRecordDto } from './dto/update-maintenance-record.dto';

@Injectable()
export class MaintenanceHistoryService {
  constructor(
    @InjectModel(MaintenanceHistory.name)
    private maintenanceModel: Model<MaintenanceHistoryDocument>,
  ) {}

  async create(dto: CreateMaintenanceRecordDto, actorId: string) {
    const record = new this.maintenanceModel({
      ...dto,
      // assetId ເປັນ string ທີ່ສ້າງເອງ (AS001) — ບໍ່ແມ່ນ ObjectId ຈຶ່ງບໍ່ຕ້ອງແປງ
      assetId: dto.assetId,
      technicianId: dto.technicianId
        ? new Types.ObjectId(dto.technicianId)
        : undefined,
      recordedBy: new Types.ObjectId(actorId),
      maintenanceDate: dto.maintenanceDate
        ? new Date(dto.maintenanceDate)
        : new Date(),
      status: dto.status || MaintenanceStatus.IN_PROGRESS,
    });
    return record.save();
  }

  async findByAssetId(assetId: string) {
    return this.maintenanceModel
      .find({ assetId })
      .sort({ maintenanceDate: -1, createdAt: -1 })
      .populate('technicianId', 'firstName lastName employeeCode')
      .populate('recordedBy', 'firstName lastName employeeCode')
      .exec();
  }

  async findAll(
    filters: { assetId?: string; status?: MaintenanceStatus } = {},
  ) {
    const query: { assetId?: string; status?: MaintenanceStatus } = {};
    if (filters.assetId) {
      query.assetId = filters.assetId;
    }
    if (filters.status) {
      query.status = filters.status;
    }
    return this.maintenanceModel
      .find(query)
      .sort({ maintenanceDate: -1, createdAt: -1 })
      .populate('technicianId', 'firstName lastName employeeCode')
      .populate('recordedBy', 'firstName lastName employeeCode')
      .populate('assetId', 'assetTag type')
      .exec();
  }

  async findOne(id: string) {
    const record = await this.maintenanceModel
      .findById(id)
      .populate('technicianId', 'firstName lastName employeeCode')
      .populate('recordedBy', 'firstName lastName employeeCode')
      .populate('assetId', 'assetTag type')
      .exec();
    if (!record) {
      throw new NotFoundException('Maintenance record not found');
    }
    return record;
  }

  async update(id: string, dto: UpdateMaintenanceRecordDto) {
    const update: UpdateQuery<MaintenanceHistoryDocument> = {};
    if (dto.completionDate) {
      update.completionDate = new Date(dto.completionDate);
    }
    if (dto.status) {
      update.status = dto.status;
    }
    if (dto.repairNotes !== undefined) {
      update.repairNotes = dto.repairNotes;
    }
    if (dto.cost !== undefined) {
      update.cost = dto.cost;
    }
    if (dto.technicianId) {
      update.technicianId = new Types.ObjectId(dto.technicianId);
    }
    const record = await this.maintenanceModel
      .findByIdAndUpdate(id, update, { new: true })
      .populate('technicianId', 'firstName lastName employeeCode')
      .populate('recordedBy', 'firstName lastName employeeCode')
      .exec();
    if (!record) {
      throw new NotFoundException('Maintenance record not found');
    }
    return record;
  }

  async remove(id: string) {
    const result = await this.maintenanceModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException('Maintenance record not found');
    }
    return { deleted: true };
  }
}
