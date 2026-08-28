import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Session, SessionDocument } from './schemas/session.schema';

export interface DeviceInfoInput {
    userAgent?: string;
    ip?: string;
    os?: string;
    browser?: string;
}

@Injectable()
export class SessionsService {
    constructor(
        @InjectModel(Session.name) private sessionModel: Model<SessionDocument>,
    ) { }

    async create(userId: string, deviceInfo: DeviceInfoInput, expiresAt: Date) {
        const session = new this.sessionModel({
            userId,
            deviceInfo,
            issuedAt: new Date(),
            lastSeenAt: new Date(),
            expiresAt,
        });
        return session.save();
    }

    async touch(sessionId: string) {
        // fire-and-forget style update; not critical if it occasionally misses
        await this.sessionModel
            .updateOne({ _id: sessionId }, { $set: { lastSeenAt: new Date() } })
            .exec();
    }

    async isValid(sessionId: string): Promise<boolean> {
        const session = await this.sessionModel.findById(sessionId).exec();
        if (!session) return false;
        if (session.revoked) return false;
        if (session.expiresAt.getTime() < Date.now()) return false;
        return true;
    }

    findAllForUser(userId: string) {
        return this.sessionModel
            .find({ userId, revoked: false })
            .sort({ lastSeenAt: -1 })
            .exec();
    }

    async revokeOwn(sessionId: string, userId: string) {
        const session = await this.sessionModel.findById(sessionId).exec();
        if (!session) throw new NotFoundException('Session not found');
        if (session.userId !== userId) {
            throw new ForbiddenException('Cannot revoke another user\'s session');
        }
        session.revoked = true;
        return session.save();
    }

    async revokeAny(sessionId: string) {
        const session = await this.sessionModel.findById(sessionId).exec();
        if (!session) throw new NotFoundException('Session not found');
        session.revoked = true;
        return session.save();
    }

    findAllForUserAsAdmin(userId: string) {
        return this.sessionModel
            .find({ userId })
            .sort({ lastSeenAt: -1 })
            .exec();
    }
}