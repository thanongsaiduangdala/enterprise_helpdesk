import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Ticket, TicketDocument, TicketStatus } from './schemas/ticket.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { DepartmentsService } from '../departments/departments.service';

@Injectable()
export class SlaBreachCheckerService {
    private readonly logger = new Logger(SlaBreachCheckerService.name);

    constructor(
        @InjectModel(Ticket.name) private ticketModel: Model<TicketDocument>,
        private notificationsService: NotificationsService,
        private departmentsService: DepartmentsService,
    ) { }

    // ຄິດໄລ່ "ວັນທີຄົບກຳນົດແທ້ຈິງ" ໂດຍບວກເອົາໄລຍະເວລາທີ່ຖືກ pause ໄປແລ້ວ (ຊ່ວງ WAITING_ON_USER
    // ທີ່ resume ແລ້ວ) ເຂົ້າໄປໃນ resolutionDueAt ເດີມ — ຊ່ວງທີ່ຍັງ pause ຢູ່ (ບໍ່ມີ resumedAt)
    // ຈະບໍ່ນັບໃສ່ນຳ ເພາະ ticket ທີ່ຍັງ WAITING_ON_USER ຢູ່ຈະຖືກຂ້າມການກວດໄປເລີຍ (ເບິ່ງລຸ່ມ)
    private computeEffectiveDueDate(ticket: TicketDocument): Date | undefined {
        if (!ticket.sla?.resolutionDueAt) return undefined;

        const totalPausedMs = (ticket.sla.pausedIntervals ?? []).reduce((sum, interval) => {
            if (interval.pausedAt && interval.resumedAt) {
                return sum + (new Date(interval.resumedAt).getTime() - new Date(interval.pausedAt).getTime());
            }
            return sum;
        }, 0);

        return new Date(new Date(ticket.sla.resolutionDueAt).getTime() + totalPausedMs);
    }

    // ແລ່ນທຸກໆ 1 ນາທີ — ຫາ ticket ທີ່ຍັງເປີດຢູ່ (ບໍ່ແມ່ນ RESOLVED/CLOSED), ບໍ່ໄດ້ pause ຢູ່
    // (WAITING_ON_USER), ຍັງບໍ່ຖືກໝາຍ breached, ແລ້ວກວດວ່າເກີນ effective due date ແລ້ວບໍ່
    @Cron(CronExpression.EVERY_MINUTE)
    async checkSlaBreaches() {
        const now = new Date();

        const candidates = await this.ticketModel
            .find({
                status: { $nin: [TicketStatus.RESOLVED, TicketStatus.CLOSED, TicketStatus.WAITING_ON_USER] },
                'sla.resolutionDueAt': { $exists: true },
                'sla.breached': false,
            })
            .exec();

        if (candidates.length === 0) return;

        let breachedCount = 0;

        for (const ticket of candidates) {
            const effectiveDueDate = this.computeEffectiveDueDate(ticket);
            if (!effectiveDueDate || now <= effectiveDueDate) continue;

            ticket.sla.breached = true;
            await ticket.save();
            breachedCount++;

            if (ticket.assignedAgent) {
                await this.notificationsService.notify(
                    ticket.assignedAgent.toString(),
                    'TICKET_SLA_BREACHED',
                    ticket._id.toString(),
                    'Ticket',
                    `Ticket ${ticket.ticketNumber} has breached its SLA resolution time`,
                    ticket.title,
                );
            } else if (ticket.departmentId) {
                try {
                    const department = await this.departmentsService.findOne(ticket.departmentId.toString());
                    const managerIds: string[] = department?.managerIds || [];

                    if (managerIds.length === 0) {
                        this.logger.warn(
                            `Ticket ${ticket.ticketNumber} breached SLA with no assigned agent and department ${ticket.departmentId} has no managerIds set — nobody was notified`,
                        );
                    }

                    for (const managerId of managerIds) {
                        await this.notificationsService.notify(
                            managerId,
                            'TICKET_SLA_BREACHED_UNASSIGNED',
                            ticket._id.toString(),
                            'Ticket',
                            `Ticket ${ticket.ticketNumber} has breached its SLA and has no assigned agent`,
                            ticket.title,
                        );
                    }
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    this.logger.warn(`Failed to notify department managers for ticket ${ticket.ticketNumber}: ${message}`);
                }
            }
        }

        if (breachedCount > 0) {
            this.logger.warn(`SLA breach check: marked ${breachedCount} ticket(s) as breached`);
        }
    }
}