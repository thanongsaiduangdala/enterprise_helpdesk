import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TicketStatus } from '../schemas/ticket.schema';

export class ChangeTicketStatusDto {
    @ApiProperty({ enum: TicketStatus, example: TicketStatus.IN_PROGRESS })
    @IsIn(Object.values(TicketStatus))
    status!: TicketStatus;

    @ApiPropertyOptional({ example: 'Waiting on user to confirm the fix worked' })
    @IsOptional()
    @IsString()
    note?: string;

    // ຮູບ/ໄຟລ໌ຢັ້ງຢືນກັບການປ່ຽນສະຖານະນີ້ (ເຊັ່ນ ຮູບຈາກການແກ້ໄຂ ແລະ ອັບໂລດໄວ້ກ່ອນຜ່ານ POST /api/uploads)
    // ຄື URL ແບບດຽວກັບ ticket.messages[].attachments — ຈະຖືກເກັບໄວ້ໃນ history ຂອງຕັກເກດ
    @ApiPropertyOptional({ example: ['/api/uploads/abc123.png'] })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(10)
    @IsString({ each: true })
    attachments?: string[];
}
