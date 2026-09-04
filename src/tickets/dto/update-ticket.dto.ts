import { PartialType, PickType } from '@nestjs/swagger';
import { CreateTicketDto } from './create-ticket.dto';

// Deliberately narrow: only title/description are safe to edit through a generic PATCH.
// ticketTypeId/branchId/departmentId/priority all have side effects (routing, SLA
// recalculation) and go through dedicated endpoints instead of a bare field-by-field PATCH.
export class UpdateTicketDto extends PartialType(
    PickType(CreateTicketDto, ['title', 'description'] as const),
) { }
