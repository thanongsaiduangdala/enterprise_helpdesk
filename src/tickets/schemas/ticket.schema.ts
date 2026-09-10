import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TicketDocument = Ticket & Document;

export enum TicketStatus {
    OPEN = 'OPEN',
    ASSIGNED = 'ASSIGNED',
    IN_PROGRESS = 'IN_PROGRESS',
    WAITING_ON_USER = 'WAITING_ON_USER',
    RESOLVED = 'RESOLVED',
    CLOSED = 'CLOSED',
}

export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

@Schema({ _id: false })
class SlaPausedInterval {
    @Prop({ required: true })
    pausedAt!: Date;

    @Prop()
    resumedAt?: Date;
}

@Schema({ _id: false })
class TicketSla {
    @Prop()
    responseDueAt?: Date;

    @Prop()
    resolutionDueAt?: Date;

    @Prop({ default: false })
    breached!: boolean;

    @Prop({ type: [SlaPausedInterval], default: [] })
    pausedIntervals!: SlaPausedInterval[];

    @Prop({ type: [Number], default: [] })
    escalationsTriggered!: number[];
}

@Schema({ _id: false })
class TicketAttachment {
    @Prop({ required: true })
    url!: string;

    @Prop({ required: true })
    filename!: string;

    @Prop({ type: Types.ObjectId, ref: 'User', required: true })
    uploadedBy!: Types.ObjectId;

    @Prop({ required: true, default: Date.now })
    uploadedAt!: Date;
}

@Schema({ _id: false })
class TicketHistoryEntry {
    @Prop({ required: true })
    action!: string;

    @Prop({ type: Types.ObjectId, ref: 'User', required: true })
    actorId!: Types.ObjectId;

    @Prop({ required: true, default: Date.now })
    timestamp!: Date;

    @Prop()
    note?: string;
}

@Schema({ _id: false })
class TicketCsat {
    @Prop({ min: 1, max: 5 })
    rating?: number;

    @Prop()
    comment?: string;

    @Prop()
    submittedAt?: Date;
}

@Schema({ _id: false })
class TicketIdleReminderState {
    @Prop({ default: 0 })
    reminderCount!: number;

    @Prop()
    lastReminderAt?: Date;
}

@Schema({ timestamps: true })
export class Ticket {
    @Prop({ required: true, unique: true })
    ticketNumber!: string;

    @Prop({ required: true })
    title!: string;

    @Prop({ required: true })
    description!: string;

    @Prop({ type: String, ref: 'TicketType', required: true })
    ticketTypeId!: string;

    @Prop({ type: String, ref: 'Branch', required: true })
    branchId!: string;

    @Prop({ type: String, ref: 'Department', required: true })
    departmentId!: string;

    @Prop({ type: Types.ObjectId, ref: 'User', required: true })
    raisedBy!: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'User' })
    assignedAgent?: Types.ObjectId;

    @Prop({ enum: TicketStatus, default: TicketStatus.OPEN })
    status!: TicketStatus;

    @Prop({ required: true, enum: TICKET_PRIORITIES })
    priority!: TicketPriority;

    @Prop({ type: Types.ObjectId, ref: 'SlaPolicy' })
    slaPolicyId?: Types.ObjectId;

    @Prop({ type: TicketSla, default: () => ({}) })
    sla!: TicketSla;

    @Prop({ type: [TicketAttachment], default: [] })
    attachments!: TicketAttachment[];

    @Prop({ type: [TicketHistoryEntry], default: [] })
    history!: TicketHistoryEntry[];

    @Prop({ type: TicketCsat, default: () => ({}) })
    csat!: TicketCsat;

    @Prop({ type: TicketIdleReminderState, default: () => ({}) })
    idleReminderState!: TicketIdleReminderState;

    @Prop({ required: true, default: Date.now })
    lastActivityAt!: Date;

    @Prop()
    resolvedAt?: Date;
}

export const TicketSchema = SchemaFactory.createForClass(Ticket);
TicketSchema.index({ branchId: 1, departmentId: 1, status: 1 });
TicketSchema.index({ assignedAgent: 1, status: 1 });
TicketSchema.index({ raisedBy: 1 });