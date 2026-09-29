import { TicketStatus } from './schemas/ticket.schema';

/**
 * Roles that a ticket may be assigned to.
 * Per the project spec: "AGENT — Resolves tickets assigned to them".
 * DEPT_MANAGER only oversees agents / SLA compliance, so managers and admins
 * are not valid assignees. Add a role name here if that rule ever changes.
 */
export const ASSIGNABLE_ROLES: string[] = ['AGENT'];

/** Tickets that still count as "work the agent needs to do". */
export const ACTIVE_WORKLOAD_STATUSES: TicketStatus[] = [
    TicketStatus.OPEN,
    TicketStatus.ASSIGNED,
    TicketStatus.IN_PROGRESS,
    TicketStatus.WAITING_ON_USER,
];
