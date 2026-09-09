import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import { MfaAttempt, MfaAttemptDocument } from './schemas/mfa-attempt.schema';

const MAX_ATTEMPTS = 5;

@Injectable()
export class MfaAttemptsService {
    constructor(
        @InjectModel(MfaAttempt.name) private mfaAttemptModel: Model<MfaAttemptDocument>,
    ) { }

    hashKey(input: string): string {
        return crypto.createHash('sha256').update(input).digest('hex');
    }

    async createChallenge(mfaToken: string, ttlSeconds: number) {
        const key = this.hashKey(mfaToken);
        await this.mfaAttemptModel.create({
            key,
            failureCount: 0,
            consumed: false,
            expiresAt: new Date(Date.now() + ttlSeconds * 1000),
        });
    }

    async assertNotConsumed(key: string) {
        const record = await this.mfaAttemptModel.findOne({ key }).exec();
        if (record?.consumed) {
            throw new UnauthorizedException('This code has already been used — please log in again');
        }
    }

    async assertNotLockedOut(key: string) {
        const record = await this.mfaAttemptModel.findOne({ key }).exec();
        if (record && record.failureCount >= MAX_ATTEMPTS) {
            throw new UnauthorizedException('Too many failed attempts — please try again later');
        }
    }

    async recordFailure(key: string, ttlSeconds: number) {
        await this.mfaAttemptModel.updateOne(
            { key },
            {
                $inc: { failureCount: 1 },
                $setOnInsert: { expiresAt: new Date(Date.now() + ttlSeconds * 1000), consumed: false },
            },
            { upsert: true },
        ).exec();
    }

    async markConsumed(key: string) {
        await this.mfaAttemptModel.updateOne({ key }, { $set: { consumed: true } }).exec();
    }

    async reset(key: string) {
        await this.mfaAttemptModel.deleteOne({ key }).exec();
    }
}