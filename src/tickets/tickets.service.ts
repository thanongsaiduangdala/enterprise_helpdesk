import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Ticket, TicketDocument, TicketStatus } from './schemas/ticket.schema';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { AssignTicketDto } from './dto/assign-ticket.dto';
import { ChangeTicketStatusDto } from './dto/change-ticket-status.dto';
import { SubmitTicketFeedbackDto } from './dto/submit-ticket-feedback.dto';
import { TicketTypesService } from '../ticket-types/ticket-types.service';
import { SlaPoliciesService } from '../sla-policies/sla-policies.service';
import { DepartmentsService } from '../departments/departments.service';
import { BranchesService } from '../branches/branches.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

// Status stepper: which transitions are legal from each state. WAITING_ON_USER can fall
// back to IN_PROGRESS (user replied, agent resumes work). RESOLVED can fall back to
// IN_PROGRESS too (the fix didn't hold, ticket gets reopened) rather than being a hard
// dead end. CLOSED is the only true terminal state.
const ALLOWED_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
    [TicketStatus.OPEN]: [TicketStatus.ASSIGNED, TicketStatus.IN_PROGRESS],
    [TicketStatus.ASSIGNED]: [TicketStatus.IN_PROGRESS],
    [TicketStatus.IN_PROGRESS]: [TicketStatus.WAITING_ON_USER, TicketStatus.RESOLVED],
    [TicketStatus.WAITING_ON_USER]: [TicketStatus.IN_PROGRESS, TicketStatus.RESOLVED],
    [TicketStatus.RESOLVED]: [TicketStatus.CLOSED, TicketStatus.IN_PROGRESS],
    [TicketStatus.CLOSED]: [],
};

@Injectable()
export class TicketsService {
    constructor(
        @InjectModel(Ticket.name) private ticketModel: Model<TicketDocument>,
        private ticketTypesService: TicketTypesService,
        private slaPoliciesService: SlaPoliciesService,
        private departmentsService: DepartmentsService,
        private branchesService: BranchesService,
        private notificationsService: NotificationsService,
        private auditLogsService: AuditLogsService,
    ) { }

    // Same gap-filling pattern as the other custom-identifier collections, just applied
    // to the ticketNumber field instead of _id (see ticket.schema.ts for why _id itself
    // stays a plain ObjectId here).
    private async generateTicketNumber(): Promise<string> {
        const tickets = await this.ticketModel
            .find({ ticketNumber: /^TCK-\d{6}$/ }, { ticketNumber: 1 })
            .sort({ ticketNumber: 1 })
            .exec();
        const used = new Set(tickets.map((t) => parseInt(t.ticketNumber.slice(4), 10)));
        let seq = 1;
        while (used.has(seq)) seq++;
        return `TCK-${String(seq).padStart(6, '0')}`;
    }

    // Naive due-date math: startAt + N minutes, flat wall-clock. The spec calls for these
    // timers to run against the branch's business hours + holiday calendar instead of raw
    // wall-clock (module 6) — that calendar-aware calculation isn't built yet, so this is
    // a placeholder that at least gets *a* deadline on the ticket rather than leaving the
    // SLA fields empty. Swap this out once the business-hours engine exists.
    private computeDueDates(startAt: Date, responseTimeMinutes: number, resolutionTimeMinutes: number) {
        return {
            responseDueAt: new Date(startAt.getTime() + responseTimeMinutes * 60_000),
            resolutionDueAt: new Date(startAt.getTime() + resolutionTimeMinutes * 60_000),
        };
    }

    private pushHistory(ticket: TicketDocument, action: string, actorId: string, note?: string) {
        ticket.history.push({ action, actorId: actorId as any, timestamp: new Date(), note });
        ticket.lastActivityAt = new Date();
    }

    async create(dto: CreateTicketDto, raisedBy: string) {
        // ASSUMPTION: TicketTypesService.findOne(id) returns an object exposing
        // defaultDepartmentId / defaultPriority, matching the field list in your spec's
        // ticketTypes collection (row 6). Adjust this call if your actual service's
        // method name or return shape differs — I don't have ticket-types.service.ts
        // to verify against.
        const ticketType = await this.ticketTypesService.findOne(dto.ticketTypeId);
        await this.branchesService.findOne(dto.branchId);

        const departmentId = dto.departmentId ?? (ticketType as any).defaultDepartmentId;
        if (!departmentId) {
            throw new BadRequestException(
                'departmentId was not provided and this ticket type has no default department to route to',
            );
        }
        await this.departmentsService.findOne(departmentId);

        const priority = dto.priority ?? (ticketType as any).defaultPriority;
        const ticketNumber = await this.generateTicketNumber();
        const now = new Date();

        const slaPolicy = await this.slaPoliciesService.findByTicketTypeAndPriority(dto.ticketTypeId, priority);
        const sla = slaPolicy
            ? {
                ...this.computeDueDates(now, slaPolicy.responseTimeMinutes, slaPolicy.resolutionTimeMinutes),
                breached: false,
                pausedIntervals: [],
            }
            : { breached: false, pausedIntervals: [] };

        const ticket = new this.ticketModel({
            ticketNumber,
            title: dto.title,
            description: dto.description,
            ticketTypeId: dto.ticketTypeId,
            branchId: dto.branchId,
            departmentId,
            raisedBy,
            status: TicketStatus.OPEN,
            priority,
            slaPolicyId: slaPolicy?._id,
            sla,
            lastActivityAt: now,
        });
        this.pushHistory(ticket, 'CREATED', raisedBy);

        // Not sent to AuditLogsService — ticket creation is routine employee usage, not a
        // sensitive admin action, same reasoning applied to supply-request creation.
        return ticket.save();
    }

    // Admin/manager filtered view — e.g. ?departmentId=DX001&status=OPEN
    findAll(filters: {
        branchId?: string;
        departmentId?: string;
        status?: TicketStatus;
        priority?: string;
        assignedAgent?: string;
    }) {
        const query: any = {};
        if (filters.branchId) query.branchId = filters.branchId;
        if (filters.departmentId) query.departmentId = filters.departmentId;
        if (filters.status) query.status = filters.status;
        if (filters.priority) query.priority = filters.priority;
        if (filters.assignedAgent) query.assignedAgent = filters.assignedAgent;
        return this.ticketModel.find(query).sort({ createdAt: -1 }).exec();
    }

    // "My tickets" — the Employee's own dashboard widget.
    findMine(userId: string) {
        return this.ticketModel.find({ raisedBy: userId }).sort({ createdAt: -1 }).exec();
    }

    // Agent's personal queue — "tickets assigned to them".
    findAssignedToMe(userId: string) {
        return this.ticketModel.find({ assignedAgent: userId }).sort({ createdAt: -1 }).exec();
    }

    async findOne(id: string) {
        const ticket = await this.ticketModel.findById(id).exec();
        if (!ticket) throw new NotFoundException('Ticket not found');
        return ticket;
    }

    // Narrow, side-effect-free field edit — see UpdateTicketDto for why this only covers
    // title/description.
    async update(id: string, dto: UpdateTicketDto) {
        const ticket = await this.ticketModel.findByIdAndUpdate(id, dto, { new: true }).exec();
        if (!ticket) throw new NotFoundException('Ticket not found');
        return ticket;
    }

    // Assigns or reassigns in one method — mirrors AssetsService.assign()'s pattern of
    // figuring out first-assignment vs reassignment purely from whether assignedAgent was
    // already set, so the caller doesn't need to know which case it is.
    async assign(id: string, dto: AssignTicketDto, actorId: string, ip?: string) {
        const ticket = await this.findOne(id);
        if (ticket.status === TicketStatus.CLOSED) {
            throw new BadRequestException('Cannot assign a closed ticket');
        }
        const before = ticket.toObject();
        const wasAssigned = !!ticket.assignedAgent;

        ticket.assignedAgent = dto.agentId as any;
        if (ticket.status === TicketStatus.OPEN) {
            ticket.status = TicketStatus.ASSIGNED;
        }

        const action = wasAssigned ? 'REASSIGNED' : 'ASSIGNED';
        this.pushHistory(ticket, action, actorId, dto.note);
        const saved = await ticket.save();

        await this.notificationsService.notify(
            dto.agentId,
            'TICKET_ASSIGNED',
            saved._id.toString(),
            'Ticket',
            `Ticket ${saved.ticketNumber} assigned to you`,
            saved.title,
        );

        await this.auditLogsService.log(
            actorId,
            wasAssigned ? 'TICKET_REASSIGNED' : 'TICKET_ASSIGNED',
            'Ticket',
            id,
            before,
            saved.toObject(),
            ip,
        );

        return saved;
    }

    // Status stepper. Enforces ALLOWED_TRANSITIONS above, auto-pauses/resumes the SLA
    // clock around WAITING_ON_USER, stamps the per-ticket history timeline, and logs to
    // the compliance audit trail — status changes were explicitly called out as worth
    // tracking alongside reassignment.
    async changeStatus(id: string, dto: ChangeTicketStatusDto, actorId: string, ip?: string) {
        const ticket = await this.findOne(id);
        const legalNext = ALLOWED_TRANSITIONS[ticket.status] ?? [];
        if (!legalNext.includes(dto.status)) {
            throw new BadRequestException(
                `Cannot move a ticket from "${ticket.status}" to "${dto.status}"`,
            );
        }
        const before = ticket.toObject();
        const fromStatus = ticket.status;

        // Pause the SLA clock on the way into WAITING_ON_USER, resume on the way out.
        if (dto.status === TicketStatus.WAITING_ON_USER) {
            ticket.sla.pausedIntervals.push({ pausedAt: new Date() });
        } else if (fromStatus === TicketStatus.WAITING_ON_USER) {
            const openInterval = ticket.sla.pausedIntervals.find((p) => !p.resumedAt);
            if (openInterval) openInterval.resumedAt = new Date();
        }

        ticket.status = dto.status;
        this.pushHistory(ticket, 'STATUS_CHANGED', actorId, dto.note ?? `${fromStatus} -> ${dto.status}`);
        const saved = await ticket.save();

        await this.auditLogsService.log(
            actorId,
            'TICKET_STATUS_CHANGED',
            'Ticket',
            id,
            before,
            saved.toObject(),
            ip,
        );

        return saved;
    }

    // Post-resolution CSAT — only the person who raised the ticket can rate it, and only
    // once it's actually resolved/closed. Not sent to the audit log — feedback isn't a
    // sensitive admin action, same category as ticket creation.
    async submitFeedback(id: string, dto: SubmitTicketFeedbackDto, userId: string) {
        const ticket = await this.findOne(id);
        if (ticket.raisedBy.toString() !== userId) {
            throw new ForbiddenException('Only the person who raised this ticket can rate it');
        }
        if (![TicketStatus.RESOLVED, TicketStatus.CLOSED].includes(ticket.status)) {
            throw new BadRequestException('Feedback can only be submitted once the ticket is resolved or closed');
        }
        ticket.csat = { rating: dto.rating, comment: dto.comment, submittedAt: new Date() };
        this.pushHistory(ticket, 'FEEDBACK_SUBMITTED', userId);
        return ticket.save();
    }

    async remove(id: string, actorId: string, ip?: string) {
        const before = await this.ticketModel.findById(id).exec();
        if (!before) throw new NotFoundException('Ticket not found');

        const result = await this.ticketModel.findByIdAndDelete(id).exec();
        if (!result) throw new NotFoundException('Ticket not found');

        await this.auditLogsService.log(
            actorId,
            'TICKET_DELETED',
            'Ticket',
            id,
            before.toObject(),
            undefined,
            ip,
        );

        return { deleted: true };
    }
}
