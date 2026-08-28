import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SlaPolicyDocument = SlaPolicy & Omit<Document, '_id'>;

@Schema({ _id: false })
class EscalationRule {
    @Prop({ required: true })
    afterMinutesOverdue!: number;

    @Prop({ required: true })
    notifyRole!: string;
}

@Schema({ _id: false })
class IdleReminder {
    @Prop({ default: false })
    enabled!: boolean;

    @Prop()
    intervalMinutes?: number; // how often to re-nudge while idle

    @Prop()
    escalateAfterReminders?: number; // e.g. after 3 nudges, notify the agent's manager too
}

@Schema({ timestamps: true })
export class SlaPolicy {
    @Prop({ type: String })
    _id!: string;

    @Prop({ required: true })
    name!: string;

    @Prop({ required: true })
    ticketTypeId!: string;

    @Prop({ required: true, enum: ['low', 'medium', 'high', 'urgent'] })
    priority!: string;

    @Prop({ required: true })
    responseTimeMinutes!: number;

    @Prop({ required: true })
    resolutionTimeMinutes!: number;

    @Prop({ type: [EscalationRule], default: [] })
    escalationRules!: EscalationRule[];

    @Prop({ type: IdleReminder, default: () => ({}) })
    idleReminder!: IdleReminder;

    @Prop({ default: true })
    isActive!: boolean;
}

export const SlaPolicySchema = SchemaFactory.createForClass(SlaPolicy);