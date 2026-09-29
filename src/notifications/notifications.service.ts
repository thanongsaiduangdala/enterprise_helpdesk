import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Notification, NotificationDocument } from './schemas/notification.schema';
import { NotificationsGateway } from './notifications.gateway';

@Injectable()
export class NotificationsService {
    private readonly logger = new Logger(NotificationsService.name);

    constructor(
        @InjectModel(Notification.name) private notificationModel: Model<NotificationDocument>,
        private notificationsGateway: NotificationsGateway,
    ) { }

    async notify(userId: string, type: string, refId: string, refModel: string, title: string, body: string) {
        const created = await this.notificationModel.create({ userId, type, refId, refModel, title, body });

        // Push live so the bell updates immediately instead of waiting for the
        // frontend's 60s poll. Never let a socket failure break the caller
        // (e.g. a ticket that was already saved but now throws on notify).
        try {
            const unreadCount = await this.unreadCount(userId);
            this.notificationsGateway.notifyUser(userId, {
                notification: created.toObject(),
                unreadCount,
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.warn(`Could not push notification over socket: ${message}`);
        }

        return created;
    }


    findMine(userId: string, unreadOnly = false) {
        const query: any = { userId };
        if (unreadOnly) query.isRead = false;
        return this.notificationModel.find(query).sort({ createdAt: -1 }).exec();
    }


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
