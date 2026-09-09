import { ForbiddenException } from '@nestjs/common';

interface PermissionEntry {
    module: string;
    actions: string[];
}

interface TicketLike {
    raisedBy: { toString(): string };
    assignedAgent?: { toString(): string };
}

export function assertInvolvedInTicket(
    ticket: TicketLike,
    userId: string,
    permissions: PermissionEntry[] | undefined,
) {
    const isRaiser = ticket.raisedBy.toString() === userId;
    const isAgent = ticket.assignedAgent?.toString() === userId;
    const hasElevatedAccess = (permissions ?? []).some(
        (p) => p.module === 'tickets' && p.actions.includes('assign'),
    );

    if (!isRaiser && !isAgent && !hasElevatedAccess) {
        throw new ForbiddenException('You are not involved in this ticket');
    }
}