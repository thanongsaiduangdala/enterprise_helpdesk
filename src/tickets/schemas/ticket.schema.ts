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
    resumedAt?: Date; // absent while still paused
}

@Schema({ _id: false })
class TicketSla {
    @Prop()
    responseDueAt?: Date;

    @Prop()
    resolutionDueAt?: Date;

    // Flipped by the (not-yet-built) SLA breach cron — never written to directly here.
    @Prop({ default: false })
    breached!: boolean;

    @Prop({ type: [SlaPausedInterval], default: [] })
    pausedIntervals!: SlaPausedInterval[];
}

@Schema({ _id: false })
class TicketAttachment {
    @Prop({ required: true })
    url!: string; // S3 object URL — the upload itself happens outside this service

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
    action!: string; // e.g. 'CREATED', 'ASSIGNED', 'STATUS_CHANGED', 'FEEDBACK_SUBMITTED'

    @Prop({ type: Types.ObjectId, ref: 'User', required: true })
    actorId!: Types.ObjectId;

    @Prop({ required: true, default: Date.now })
    timestamp!: Date;

    @Prop()
    note?: string; // free text, e.g. "OPEN -> ASSIGNED"

    // NOTE: this is the user-facing per-ticket timeline (spec: "Ticket history/timeline
    // log"), separate from the compliance-grade AuditLogs collection. Sensitive actions
    // (assign/reassign, status change, delete) get written to BOTH — this one for anyone
    // viewing the ticket, AuditLogs for the tamper-evident admin/auditor trail.
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

@Schema({ timestamps: true })
export class Ticket {
    // Human-facing identifier, e.g. 'TCK-000042'. Kept separate from _id (which stays a
    // normal auto-generated ObjectId here, unlike the AN/BX/DX/R custom-_id collections)
    // since a ticket number is display/reference text, not a routing key other
    // collections join against.
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

    // Absent until the ticket is first assigned.
    @Prop({ type: Types.ObjectId, ref: 'User' })
    assignedAgent?: Types.ObjectId;

    @Prop({ enum: TicketStatus, default: TicketStatus.OPEN })
    status!: TicketStatus;

    @Prop({ required: true, enum: TICKET_PRIORITIES })
    priority!: TicketPriority;

    // Snapshot of which policy applied at creation time — if the underlying SlaPolicy
    // is edited later, this ticket's due dates shouldn't silently drift with it.
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

    @Prop({ required: true, default: Date.now })
    lastActivityAt!: Date;
}

export const TicketSchema = SchemaFactory.createForClass(Ticket);
TicketSchema.index({ branchId: 1, departmentId: 1, status: 1 });
TicketSchema.index({ assignedAgent: 1, status: 1 });
TicketSchema.index({ raisedBy: 1 });
TicketSchema.index({ ticketNumber: 1 }, { unique: true });
