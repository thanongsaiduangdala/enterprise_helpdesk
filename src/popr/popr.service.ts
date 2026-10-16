import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PoprItemType,
  PoprRecord,
  PoprRecordDocument,
  PoprStatus,
} from './schemas/popr-record.schema';
import { CreatePoprRecordDto } from './dto/create-popr-record.dto';
import { UpdatePoprRecordDto } from './dto/update-popr-record.dto';

@Injectable()
export class PoprService {
  constructor(
    @InjectModel(PoprRecord.name)
    private poprModel: Model<PoprRecordDocument>,
  ) {}

  private async generateId(): Promise<string> {
    const items = await this.poprModel
      .find({ _id: /^POPR-\d{4}$/ }, { _id: 1 })
      .sort({ _id: -1 })
      .limit(1)
      .exec();
    const last = items[0]?._id;
    const next = last ? parseInt(last.slice('POPR-'.length), 10) + 1 : 1;
    return `POPR-${String(next).padStart(4, '0')}`;
  }

  /** ແປງ DTO (ມີ string ວັນທີ) → payload ທີ່ບັນທຶກໄດ້ (Date) */
  private buildPayload(dto: CreatePoprRecordDto | UpdatePoprRecordDto) {
    const payload: Record<string, any> = {};
    if (dto.status !== undefined) payload.status = dto.status;
    if (dto.itemType !== undefined) payload.itemType = dto.itemType;
    if (dto.stage !== undefined) payload.stage = dto.stage;

    if (dto.procurement) {
      const { ...p } = dto.procurement;
      payload.procurement = { ...p };
    }
    if (dto.receiving) {
      const { receivedDate, receivedByUserId, assetId, ...rest } =
        dto.receiving;
      payload.receiving = {
        ...rest,
        ...(assetId ? { assetId } : {}),
        ...(receivedByUserId
          ? { receivedByUserId: new Types.ObjectId(receivedByUserId) }
          : {}),
        ...(receivedDate ? { receivedDate: new Date(receivedDate) } : {}),
      };
    }
    if (dto.preparation) {
      payload.preparation = { ...dto.preparation };
    }
    if (dto.release) {
      const { deliveryDate, deliveredToUserId, assignedUserId, ...rest } =
        dto.release;
      payload.release = {
        ...rest,
        ...(deliveredToUserId
          ? { deliveredToUserId: new Types.ObjectId(deliveredToUserId) }
          : {}),
        ...(assignedUserId
          ? { assignedUserId: new Types.ObjectId(assignedUserId) }
          : {}),
        ...(deliveryDate ? { deliveryDate: new Date(deliveryDate) } : {}),
      };
    }
    return payload;
  }

  /** ບັງຄັບຂໍ້ມູນຈຳເປັນກ່ອນປິດສຳເລັດ — ອຸປະກອນທົ່ວໄປ (GENERAL) ບໍ່ບັງຄັບ S/N/OS/ຄວາມປອດໄພ */
  private assertCompletable(record: PoprRecordDocument) {
    const missing: string[] = [];
    const isGeneral = record.itemType === PoprItemType.GENERAL;

    const p = record.procurement ?? {};
    if (!p.itemName) missing.push('procurement.itemName');
    if (!p.spec) missing.push('procurement.spec');
    if (p.budget === undefined || p.budget === null)
      missing.push('procurement.budget');
    if (!p.vendor) missing.push('procurement.vendor');
    if (!p.poNumber) missing.push('procurement.poNumber');

    const o = record.receiving ?? {};
    if (!o.receivedDate) missing.push('receiving.receivedDate');
    if (!o.assetTag) missing.push('receiving.assetTag');
    if (!isGeneral) {
      if (!o.serialNumber) missing.push('receiving.serialNumber');
      if (!o.snMatch) missing.push('receiving.snMatch');
    }

    if (!isGeneral) {
      const c = record.preparation ?? {};
      if (!c.os) missing.push('preparation.os');
      if (!c.secAntivirus && !c.secEdr && !c.secFirewall)
        missing.push('preparation.securitySoftware');
    }

    const r = record.release ?? {};
    if (!r.deliveredTo) missing.push('release.deliveredTo');
    if (!r.assignedUser) missing.push('release.assignedUser');
    if (!r.signedHandover) missing.push('release.signedHandover');

    if (missing.length > 0) {
      throw new BadRequestException(
        `POPR ຍັງບໍ່ສົມບູນ ຈຶ່ງປິດສຳເລັດບໍ່ໄດ້. ຂາດ: ${missing.join(', ')}`,
      );
    }
  }

  async create(dto: CreatePoprRecordDto, userId: string) {
    const payload = this.buildPayload(dto);
    const status = dto.status ?? PoprStatus.DRAFT;
    const _id = await this.generateId();
    const record = new this.poprModel({
      _id,
      createdBy: new Types.ObjectId(userId),
      ...payload,
      status,
      stage: dto.stage ?? 1,
    });
    if (status === PoprStatus.COMPLETED) {
      this.assertCompletable(record);
      record.stage = 4;
      record.completedAt = new Date();
    }
    return record.save();
  }

  findAll(filters: { status?: PoprStatus; q?: string } = {}) {
    const query: Record<string, any> = {};
    if (filters.status) query.status = filters.status;
    if (filters.q) {
      const rx = new RegExp(
        filters.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i',
      );
      query.$or = [
        { _id: rx },
        { 'procurement.itemName': rx },
        { 'procurement.vendor': rx },
        { 'procurement.poNumber': rx },
        { 'receiving.serialNumber': rx },
        { 'receiving.assetTag': rx },
        { 'release.assignedUser': rx },
      ];
    }
    return this.poprModel
      .find(query)
      .sort({ createdAt: -1 })
      .populate('createdBy', 'firstName lastName email employeeCode')
      .populate('receiving.receivedByUserId', 'firstName lastName employeeCode')
      .populate('release.deliveredToUserId', 'firstName lastName employeeCode')
      .populate('release.assignedUserId', 'firstName lastName employeeCode')
      .populate('receiving.assetId', 'assetTag type status')
      .exec();
  }

  async findOne(id: string) {
    const record = await this.poprModel
      .findById(id)
      .populate('createdBy', 'firstName lastName email employeeCode')
      .populate('receiving.receivedByUserId', 'firstName lastName employeeCode')
      .populate('release.deliveredToUserId', 'firstName lastName employeeCode')
      .populate('release.assignedUserId', 'firstName lastName employeeCode')
      .populate('receiving.assetId', 'assetTag type status')
      .exec();
    if (!record) throw new NotFoundException('POPR record not found');
    return record;
  }

  async update(id: string, dto: UpdatePoprRecordDto) {
    const record = await this.poprModel.findById(id).exec();
    if (!record) throw new NotFoundException('POPR record not found');

    if (record.status === PoprStatus.COMPLETED) {
      throw new BadRequestException('POPR ທີ່ປິດສຳເລັດແລ້ວ ບໍ່ສາມາດແກ້ໄຂໄດ້');
    }

    const payload = this.buildPayload(dto);
    Object.assign(record, payload);
    this.clearUnlinkedRefs(record, dto);

    if (dto.status === PoprStatus.COMPLETED) {
      this.assertCompletable(record);
      record.stage = 4;
      if (!record.completedAt) record.completedAt = new Date();
    }
    return record.save();
  }

  private clearUnlinkedRefs(
    record: PoprRecordDocument,
    dto: CreatePoprRecordDto | UpdatePoprRecordDto,
  ) {
    const rec = dto.receiving;
    if (rec) {
      if ('assetId' in rec && !rec.assetId)
        record.set('receiving.assetId', undefined);
      if ('receivedByUserId' in rec && !rec.receivedByUserId)
        record.set('receiving.receivedByUserId', undefined);
    }
    const rel = dto.release;
    if (rel) {
      if ('deliveredToUserId' in rel && !rel.deliveredToUserId)
        record.set('release.deliveredToUserId', undefined);
      if ('assignedUserId' in rel && !rel.assignedUserId)
        record.set('release.assignedUserId', undefined);
    }
  }

  async complete(id: string) {
    const record = await this.poprModel.findById(id).exec();
    if (!record) throw new NotFoundException('POPR record not found');
    this.assertCompletable(record);
    record.status = PoprStatus.COMPLETED;
    record.stage = 4;
    record.completedAt = new Date();
    return record.save();
  }

  async remove(id: string) {
    const result = await this.poprModel.findByIdAndDelete(id).exec();
    if (!result) throw new NotFoundException('POPR record not found');
    return { deleted: true };
  }
}
