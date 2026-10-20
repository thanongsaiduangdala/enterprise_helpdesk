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

/**
 * ການແກ້ໄຂ ticket (ປ່ຽນສະຖານະ / ແກ້ຫົວຂໍ້-ລາຍລະອຽດ): ອະນຸຍາດສະເພາະ
 *  - Agent ທີ່ຖືກມອບໝາຍ ticket ນັ້ນ, ຫຼື
 *  - ຜູ້ທີ່ມີສິດ tickets:assign (ຫົວໜ້າ/ຜູ້ບໍລິຫານ)
 * ຜູ້ທີ່ມີພຽງ tickets:update ແຕ່ບໍ່ໄດ້ຖືກມອບໝາຍ ຈະແກ້ ticket ຂອງຄົນອື່ນບໍ່ໄດ້
 */
export function assertCanModifyTicket(
  ticket: TicketLike,
  userId: string,
  permissions: PermissionEntry[] | undefined,
) {
  const isAssignedAgent = ticket.assignedAgent?.toString() === userId;
  const hasElevatedAccess = (permissions ?? []).some(
    (p) => p.module === 'tickets' && p.actions.includes('assign'),
  );

  if (!isAssignedAgent && !hasElevatedAccess) {
    throw new ForbiddenException(
      'Only the assigned agent (or a manager) can change this ticket',
    );
  }
}
