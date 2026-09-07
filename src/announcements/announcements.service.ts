import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Announcement, AnnouncementDocument, AnnouncementScope } from './schemas/announcement.schema';
import { AnnouncementRead, AnnouncementReadDocument } from './schemas/announcement-read.schema';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class AnnouncementsService {
    constructor(
        @InjectModel(Announcement.name) private announcementModel: Model<AnnouncementDocument>,
        @InjectModel(AnnouncementRead.name) private readModel: Model<AnnouncementReadDocument>,
        private usersService: UsersService,
        private notificationsService: NotificationsService,
    ) { }


    private async generateId(): Promise<string> {
        const items = await this.announcementModel
            .find({ _id: /^AN\d{3}$/ }, { _id: 1 })
            .sort({ _id: 1 })
            .exec();
        const usedNumbers = new Set(items.map((a) => parseInt(a._id.slice(2), 10)));
        let seq = 1;
        while (usedNumbers.has(seq)) seq++;
        return `AN${String(seq).padStart(3, '0')}`;
    }

    async create(dto: CreateAnnouncementDto, createdBy: string) {
        if (dto.scope === AnnouncementScope.BRANCH && !dto.branchId) {
            throw new BadRequestException('branchId is required when scope is BRANCH');
        }
        if (dto.scope === AnnouncementScope.DEPARTMENT && !dto.departmentId) {
            throw new BadRequestException('departmentId is required when scope is DEPARTMENT');
        }
        const _id = await this.generateId();
        const announcement = await new this.announcementModel({
            _id,
            ...dto,
            publishAt: dto.publishAt ? new Date(dto.publishAt) : new Date(),
            expireAt: dto.expireAt ? new Date(dto.expireAt) : undefined,
            createdBy,
        }).save();
        await this.notifyScope(announcement);

        return announcement;
    }

    private async notifyScope(announcement: AnnouncementDocument) {
        let recipients: { _id: any }[] = [];
        if (announcement.scope === AnnouncementScope.COMPANY) {
            recipients = await this.usersService.findAllActive();
        } else if (announcement.scope === AnnouncementScope.BRANCH && announcement.branchId) {
            recipients = await this.usersService.findActiveByBranch(announcement.branchId);
        } else if (announcement.scope === AnnouncementScope.DEPARTMENT && announcement.departmentId) {
            recipients = await this.usersService.findActiveByDepartment(announcement.departmentId);
        }

        await Promise.all(
            recipients.map((user) =>
                this.notificationsService.notify(
                    user._id.toString(),
                    'ANNOUNCEMENT',
                    announcement._id,
                    'Announcement',
                    announcement.title,
                    announcement.body,
                ),
            ),
        );
    }


    findAll() {
        return this.announcementModel.find().sort({ createdAt: -1 }).exec();
    }

    async findOne(id: string) {
        const announcement = await this.announcementModel.findById(id).exec();
        if (!announcement) throw new NotFoundException('Announcement not found');
        return announcement;
    }

    async findActiveForUser(userId: string): Promise<Array<Record<string, any>>> {
        const user = await this.usersService.findOne(userId);
        const now = new Date();
        const scopeConditions: any[] = [{ scope: AnnouncementScope.COMPANY }];
        if (user.branchId) scopeConditions.push({ scope: AnnouncementScope.BRANCH, branchId: user.branchId });
        if (user.departmentId) scopeConditions.push({ scope: AnnouncementScope.DEPARTMENT, departmentId: user.departmentId });

        const announcements = await this.announcementModel
            .find({
                $and: [
                    { $or: [{ expireAt: { $exists: false } }, { expireAt: { $gte: now } }] },
                    { $or: scopeConditions },
                ],
                publishAt: { $lte: now },
            })
            .sort({ pinned: -1, publishAt: -1 })
            .exec();

        const readIds = new Set(
            (await this.readModel.find({ userId }).distinct('announcementId').exec()) as unknown as string[],
        );

        return announcements.map((a) => ({ ...a.toObject(), isRead: readIds.has(a._id) }));
    }

    async update(id: string, dto: UpdateAnnouncementDto) {
        const announcement = await this.announcementModel.findByIdAndUpdate(id, dto, { new: true }).exec();
        if (!announcement) throw new NotFoundException('Announcement not found');
        return announcement;
    }

    async setPinned(id: string, pinned: boolean) {
        const announcement = await this.announcementModel.findByIdAndUpdate(id, { pinned }, { new: true }).exec();
        if (!announcement) throw new NotFoundException('Announcement not found');
        return announcement;
    }

    async remove(id: string) {
        const result = await this.announcementModel.findByIdAndDelete(id).exec();
        if (!result) throw new NotFoundException('Announcement not found');
        await this.readModel.deleteMany({ announcementId: id }).exec();
        return { deleted: true };
    }

    async markRead(announcementId: string, userId: string) {
        await this.announcementModel.findById(announcementId).exec().then((a) => {
            if (!a) throw new NotFoundException('Announcement not found');
        });
        try {
            await this.readModel.create({ announcementId, userId, readAt: new Date() });
        } catch (err: any) {
            if (err.code !== 11000) throw err;
        }
        return { read: true };
    }

    whoRead(announcementId: string) {
        return this.readModel.find({ announcementId }).populate('userId', 'employeeCode firstName lastName email').exec();
    }
}
