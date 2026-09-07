import { PartialType, PickType } from '@nestjs/swagger';
import { CreateTicketDto } from './create-ticket.dto';




export class UpdateTicketDto extends PartialType(
    PickType(CreateTicketDto, ['title', 'description'] as const),
) { }
