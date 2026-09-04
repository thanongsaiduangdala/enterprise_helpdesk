import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Notification, NotificationDocument } from './schemas/notification.schema';

@Injectable()
export class NotificationsService {
    constructor(
        @InjectModel(Notification.name) private notificationModel: Model<NotificationDocument>,
    ) { }

    // Called by OTHER services via dependency injection (e.g. the future SLA breach cron,
    // ticket assignment, supply request approval) — not exposed as a public HTTP endpoint.
    // Users should never be able to create a notification pointed at themselves or anyone else.
    async notify(userId: string, type: string, refId: string, refModel: string, title: string, body: string) {
        return this.notificationModel.create({ userId, type, refId, refModel, title, body });
    }

    // Personal inbox — always scoped to the requesting user, never someone else's.
    findMine(userId: string, unreadOnly = false) {
        const query: any = { userId };
        if (unreadOnly) query.isRead = false;
        return this.notificationModel.find(query).sort({ createdAt: -1 }).exec();
    }

    // Bell-icon badge count.
    unreadCount(userId: string) {
        return this.notificationModel.countDocuments({ userId, isRead: false }).exec();
    }

    async markRead(id: string, userId: string) {
        const notification = await this.notificationModel.findById(id).exec();
        if (!notification) throw new NotFoundException('Notification not found');
        if (notification.userId.toString() !== userId) {
            throw new ForbiddenException('You can only mark your own notifications as read');
        }
        notification.isRead = true;
        return notification.save();
    }

    async markAllRead(userId: string) {
        const result = await this.notificationModel.updateMany({ userId, isRead: false }, { isRead: true }).exec();
        return { updated: result.modifiedCount };
    }
}
