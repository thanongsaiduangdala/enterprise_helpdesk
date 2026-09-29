import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { parse } from 'csv-parse/sync';
import { Ticket, TicketDocument, TicketStatus, TICKET_PRIORITIES } from './schemas/ticket.schema';
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
import { assertInvolvedInTicket } from '../common/utils/ticket-access.util';
import { UsersService } from '../users/users.service';
import { TicketsGateway } from './tickets.gateway';
import { ACTIVE_WORKLOAD_STATUSES, ASSIGNABLE_ROLES } from './ticket-assignment.constants';

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
    private readonly logger = new Logger(TicketsService.name);
    private bulkImporting = false;

    constructor(
        @InjectModel(Ticket.name) private ticketModel: Model<TicketDocument>,
        private ticketTypesService: TicketTypesService,
        private slaPoliciesService: SlaPoliciesService,
        private departmentsService: DepartmentsService,
        private branchesService: BranchesService,
        private notificationsService: NotificationsService,
        private auditLogsService: AuditLogsService,
        private usersService: UsersService,
        private ticketsGateway: TicketsGateway,
    ) { }

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
        if (!priority || !TICKET_PRIORITIES.includes(priority as any)) {
            throw new BadRequestException(
                `Could not resolve a valid level of importance for this ticket type (got "${priority ?? 'none'}") — expected one of ${TICKET_PRIORITIES.join(', ')}`,
            );
        }

        const now = new Date();

        const slaPolicy = await this.slaPoliciesService.findByTicketTypeAndPriority(dto.ticketTypeId, priority);
        if (!slaPolicy) {
            const available = await this.slaPoliciesService.findAvailablePriorities(dto.ticketTypeId);
            throw new BadRequestException(
                `No active SLA policy is configured for ticket type "${(ticketType as any).name}" at level of importance "${priority}". ` +
                (available.length
                    ? `Levels that do have an SLA: ${available.join(', ')}. Submit with one of those, or ask an administrator to add an SLA policy for "${priority}".`
                    : 'This ticket type has no SLA policies at all. Ask an administrator to add one before raising tickets against it.'),
            );
        }

        const sla = {
            ...this.computeDueDates(now, slaPolicy.responseTimeMinutes, slaPolicy.resolutionTimeMinutes),
            breached: false,
            pausedIntervals: [],
        };

        const ticketNumber = await this.generateTicketNumber();

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
            slaPolicyId: slaPolicy._id,
            sla,
            lastActivityAt: now,
        });
        this.pushHistory(ticket, 'CREATED', raisedBy);

        const saved = await ticket.save();
        // During bulk import we suppress per-row side effects and emit one
        // summary at the end, otherwise a 500-row CSV fires 500 socket events
        // and 500 manager notifications.
        if (!this.bulkImporting) {
            await this.notifyDepartmentManagers(
                saved,
                'TICKET_CREATED',
                `New ticket ${saved.ticketNumber}: ${saved.title}`,
            );
            this.ticketsGateway.emitTicketChanged(saved._id.toString(), 'created');
        }
        return saved;
    }

    /**
     * ແຈ້ງເຕືອນຜູ້ຈັດການຂອງທີ່ຢູ່ໃນເດີປາດດຽວກັນ (departmentId) — ຖ້າບໍ່ມີ manager ໃນຂອງ ຫຼື manager
     * ບໍ່ active ຈະບໍ່ສົ່ງໃຫ້ໃຄ້ (ເພື່ອບໍ່ໃຫ້ create ລົ້ມ)
     */
    private async notifyDepartmentManagers(
        ticket: TicketDocument,
        type: string,
        title: string,
    ) {
        try {
            const department: any = await this.departmentsService.findOne(ticket.departmentId);
            const managerIds: string[] = department?.managerIds ?? [];
            if (managerIds.length === 0) return;

            const recipients = [...new Set(managerIds.map((id) => id.toString()))]
                .filter((id) => id !== ticket.raisedBy.toString());

            await Promise.all(
                recipients.map((userId) =>
                    this.notificationsService.notify(
                        userId,
                        type,
                        ticket._id.toString(),
                        'Ticket',
                        title,
                        ticket.description?.slice(0, 200) ?? '',
                    ),
                ),
            );
        } catch (error) {
            this.logger.error(
                `Failed to notify department managers for ticket ${ticket._id}: ${(error as Error).message}`,
            );
        }
    }

    async bulkImport(fileBuffer: Buffer, raisedBy: string) {
        let rows: Record<string, string>[];
        try {
            rows = parse(fileBuffer, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });
        } catch (err: any) {
            throw new ConflictException(`Could not parse CSV file: ${err.message}`);
        }

        const results: Array<{ row: number; reference: string; success: boolean; error?: string }> = [];

        this.bulkImporting = true;
        try {
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const rowNumber = i + 2;
                try {
                    if (!row.title || !row.description || !row.ticketTypeId || !row.branchId) {
                        throw new Error('Missing one or more required fields (title, description, ticketTypeId, branchId)');
                    }
                    if (row.priority && !TICKET_PRIORITIES.includes(row.priority as any)) {
                        throw new Error(
                            `Invalid priority "${row.priority}" — expected one of ${TICKET_PRIORITIES.join(', ')}`,
                        );
                    }
                    const dto: CreateTicketDto = {
                        title: row.title,
                        description: row.description,
                        ticketTypeId: row.ticketTypeId,
                        branchId: row.branchId,
                        departmentId: row.departmentId || undefined,
                        priority: row.priority || undefined,
                    };
                    await this.create(dto, raisedBy);
                    results.push({ row: rowNumber, reference: row.title, success: true });
                } catch (error: any) {
                    results.push({ row: rowNumber, reference: row.title ?? '', success: false, error: error.message ?? 'Unknown error' });
                }
            }
        } finally {
            this.bulkImporting = false;
        }

        const created = results.filter((r) => r.success).length;
        if (created > 0) {
            this.ticketsGateway.emitTicketChanged('', 'created', { bulk: true, count: created });
        }

        return {
            total: rows.length,
            created,
            failed: results.filter((r) => !r.success).length,
            results,
        };
    }

    async findAll(
        filters: {
            branchId?: string;
            departmentId?: string;
            status?: TicketStatus;
            priority?: string;
            assignedAgent?: string;
        },
        requestingUserId: string,
        requestingUserRole: string,
    ) {
        const query: any = {};

        // Role-based visibility — always enforced server-side, never trusted from the client.
        if (requestingUserRole === 'EMPLOYEE' || requestingUserRole === 'AGENT') {
            query.$or = [{ raisedBy: requestingUserId }, { assignedAgent: requestingUserId }];
        } else if (requestingUserRole === 'DEPT_MANAGER') {
            const me = await this.usersService.findOneRaw(requestingUserId);
            query.departmentId = me.departmentId;
        } else if (requestingUserRole === 'BRANCH_ADMIN') {
            const me = await this.usersService.findOneRaw(requestingUserId);
            query.branchId = me.branchId;
        }
        // SUPER_ADMIN / AUDITOR: no forced scope — org-wide visibility.

        // Explicit filters from the UI still apply on top of (never instead of) the role scope above.
        if (filters.branchId) query.branchId = filters.branchId;
        if (filters.departmentId) query.departmentId = filters.departmentId;
        if (filters.status) query.status = filters.status;
        if (filters.priority) query.priority = filters.priority;
        if (filters.assignedAgent) query.assignedAgent = filters.assignedAgent;

        return this.ticketModel.find(query).sort({ createdAt: -1 }).exec();
    }

    findMine(userId: string) {
        return this.ticketModel.find({ raisedBy: userId }).sort({ createdAt: -1 }).exec();
    }

    findAssignedToMe(userId: string) {
        return this.ticketModel.find({ assignedAgent: userId }).sort({ createdAt: -1 }).exec();
    }

    async findOne(id: string) {
        if (!Types.ObjectId.isValid(id)) {
            throw new BadRequestException('Invalid ticket id');
        }
        const ticket = await this.ticketModel.findById(id).exec();
        if (!ticket) throw new NotFoundException('Ticket not found');
        return ticket;
    }

    async findOneForUser(id: string, userId: string, permissions: any[]) {
        const ticket = await this.findOne(id);
        assertInvolvedInTicket(ticket, userId, permissions);
        await ticket.populate(['raisedBy', 'assignedAgent', 'history.actorId']);
        return ticket;
    }

    async update(id: string, dto: UpdateTicketDto) {
        const ticket = await this.ticketModel.findByIdAndUpdate(id, dto, { new: true }).exec();
        if (!ticket) throw new NotFoundException('Ticket not found');
        this.ticketsGateway.emitTicketChanged(ticket._id.toString(), 'updated');
        return ticket;
    }

    /**
     * Throws unless `agentId` is an active user whose role is assignable and who
     * belongs to the same branch + department the ticket was routed to.
     */
    private async assertAssignable(ticket: TicketDocument, agentId: string) {
        let agent: any;
        try {
            agent = await this.usersService.findOne(agentId);
        } catch {
            throw new BadRequestException('The selected assignee does not exist');
        }

        if (!agent.isActive) {
            throw new BadRequestException('Cannot assign a ticket to a deactivated user');
        }

        const roleName: string | undefined = agent.role?.name;
        if (!roleName || !ASSIGNABLE_ROLES.includes(roleName)) {
            throw new BadRequestException(
                `Tickets can only be assigned to: ${ASSIGNABLE_ROLES.join(', ')} (selected user has role "${roleName ?? 'unknown'}")`,
            );
        }

        const agentDeptId = String(agent.departmentId?._id ?? agent.departmentId ?? '');
        if (agentDeptId !== String(ticket.departmentId)) {
            throw new BadRequestException(
                'The selected agent does not belong to the department this ticket is routed to',
            );
        }
        if (String(agent.branchId) !== String(ticket.branchId)) {
            throw new BadRequestException('The selected agent does not belong to the branch of this ticket');
        }
    }

    /**
     * Agents that can currently be assigned this ticket (active, assignable role,
     * same department + branch), each with how many unfinished tickets they hold.
     * Sorted least-busy first.
     */
    async getAssignableAgents(ticketId: string) {
        const ticket = await this.findOne(ticketId);
        const candidates = await this.usersService.findAssignmentCandidates(
            ticket.branchId,
            ticket.departmentId,
            ASSIGNABLE_ROLES,
        );

        const ids = candidates.map((u: any) => u._id as Types.ObjectId);
        const counts = ids.length
            ? await this.ticketModel.aggregate([
                { $match: { assignedAgent: { $in: ids }, status: { $in: ACTIVE_WORKLOAD_STATUSES } } },
                { $group: { _id: '$assignedAgent', count: { $sum: 1 } } },
            ])
            : [];
        const countById = new Map<string, number>(counts.map((c: any) => [String(c._id), c.count]));
        const currentAgentId = ticket.assignedAgent ? String(ticket.assignedAgent) : null;

        return candidates
            .map((u: any) => ({
                _id: String(u._id),
                firstName: u.firstName,
                lastName: u.lastName,
                email: u.email,
                employeeCode: u.employeeCode,
                roleName: u.role?.name,
                activeTickets: countById.get(String(u._id)) ?? 0,
                isCurrentAssignee: String(u._id) === currentAgentId,
            }))
            .sort((a, b) => a.activeTickets - b.activeTickets || `${a.firstName}`.localeCompare(`${b.firstName}`));
    }

    async assign(id: string, dto: AssignTicketDto, actorId: string, ip?: string) {
        const ticket = await this.findOne(id);
        if (ticket.status === TicketStatus.CLOSED) {
            throw new BadRequestException('Cannot assign a closed ticket');
        }
        await this.assertAssignable(ticket, dto.agentId);
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

        this.ticketsGateway.emitTicketChanged(saved._id.toString(), 'assigned');
        return saved;
    }

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

        if (dto.status === TicketStatus.WAITING_ON_USER) {
            ticket.sla.pausedIntervals.push({ pausedAt: new Date() });
        } else if (fromStatus === TicketStatus.WAITING_ON_USER) {
            const openInterval = ticket.sla.pausedIntervals.find((p) => !p.resumedAt);
            if (openInterval) openInterval.resumedAt = new Date();
        }

        if (dto.status === TicketStatus.RESOLVED) {
            ticket.resolvedAt = new Date();
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

        this.ticketsGateway.emitTicketChanged(saved._id.toString(), 'status-changed', {
            from: fromStatus,
            to: dto.status,
        });
        return saved;
    }

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
        const saved = await ticket.save();
        this.ticketsGateway.emitTicketChanged(saved._id.toString(), 'feedback');
        return saved;
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

        this.ticketsGateway.emitTicketChanged(id, 'deleted');
        return { deleted: true };
    }
}