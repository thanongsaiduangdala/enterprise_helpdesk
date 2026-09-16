import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Ticket, TicketDocument, TicketStatus } from './schemas/ticket.schema';
import { SlaPoliciesService } from '../sla-policies/sla-policies.service';
import { DepartmentsService } from '../departments/departments.service';
import { RolesService } from '../roles/roles.service';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';





const OPEN_STATUSES = [
    TicketStatus.OPEN,
    TicketStatus.ASSIGNED,
    TicketStatus.IN_PROGRESS,
];

const IDLE_TRACKED_STATUSES = [TicketStatus.ASSIGNED, TicketStatus.IN_PROGRESS];

@Injectable()
export class SlaMonitorService {
    private readonly logger = new Logger(SlaMonitorService.name);

    constructor(
        @InjectModel(Ticket.name) private ticketModel: Model<TicketDocument>,
        private slaPoliciesService: SlaPoliciesService,
        private departmentsService: DepartmentsService,
        private rolesService: RolesService,
        private usersService: UsersService,
        private notificationsService: NotificationsService,
    ) { }

    private async resolveRecipients(ticket: TicketDocument, notifyRole: string): Promise<string[]> {
        if (notifyRole === 'DEPT_MANAGER') {
            const department = await this.departmentsService.findOne(ticket.departmentId);
            return (department.managerIds ?? []) as string[];
        }
        const role = await this.rolesService.findByName(notifyRole);
        if (!role) {
            this.logger.warn(`Escalation rule references unknown role "${notifyRole}" — skipping`);
            return [];
        }
        const users = await this.usersService.findActiveByRoleIds([role._id]);
        return users.map((u: any) => u._id.toString());
    }







    private computeEffectiveDueDate(ticket: TicketDocument): Date | undefined {
        if (!ticket.sla?.resolutionDueAt) return undefined;

        const totalPausedMs = (ticket.sla.pausedIntervals ?? []).reduce((sum, interval) => {
            if (interval.pausedAt && interval.resumedAt) {
                return sum + (new Date(interval.resumedAt).getTime() - new Date(interval.pausedAt).getTime());
            }
            return sum;
        }, 0);

        return new Date(ticket.sla.resolutionDueAt.getTime() + totalPausedMs);
    }

    @Cron(CronExpression.EVERY_5_MINUTES)
    async checkBreaches() {
        const now = new Date();
        const candidates = await this.ticketModel.find({
            status: { $in: OPEN_STATUSES },
            'sla.resolutionDueAt': { $exists: true },
        }).exec();

        if (!candidates.length) return;

        let checkedCount = 0;
        for (const ticket of candidates) {
            const effectiveDueDate = this.computeEffectiveDueDate(ticket);
            if (!effectiveDueDate || now <= effectiveDueDate) continue;
            checkedCount++;

            const minutesOverdue = Math.floor((now.getTime() - effectiveDueDate.getTime()) / 60_000);

            if (!ticket.sla.breached) {
                ticket.sla.breached = true;
                ticket.history.push({
                    action: 'SLA_BREACHED',
                    actorId: ticket.raisedBy,
                    timestamp: now,
                    note: `Resolution SLA breached by ${minutesOverdue} minute(s)`,
                });

                if (ticket.assignedAgent) {
                    await this.notificationsService.notify(
                        ticket.assignedAgent.toString(),
                        'SLA_BREACH',
                        ticket._id.toString(),
                        'Ticket',
                        `SLA breached: ${ticket.ticketNumber}`,
                        'This ticket\'s resolution deadline has passed.',
                    );
                }
            }

            if (ticket.slaPolicyId) {
                const policy = await this.slaPoliciesService.findOne(ticket.slaPolicyId.toString());
                for (const rule of policy.escalationRules ?? []) {
                    const alreadyFired = ticket.sla.escalationsTriggered.includes(rule.afterMinutesOverdue);
                    if (!alreadyFired && minutesOverdue >= rule.afterMinutesOverdue) {
                        const recipients = await this.resolveRecipients(ticket, rule.notifyRole);
                        await Promise.all(
                            recipients.map((userId) =>
                                this.notificationsService.notify(
                                    userId,
                                    'SLA_ESCALATION',
                                    ticket._id.toString(),
                                    'Ticket',
                                    `Escalation: ${ticket.ticketNumber} is ${minutesOverdue}m overdue`,
                                    ticket.title,
                                ),
                            ),
                        );
                        ticket.sla.escalationsTriggered.push(rule.afterMinutesOverdue);
                    }
                }
            }

            await ticket.save();
        }

        if (checkedCount > 0) {
            this.logger.log(`SLA breach check: processed ${checkedCount} overdue ticket(s)`);
        }
    }

    @Cron(CronExpression.EVERY_MINUTE)
    async checkIdleTickets() {
        const now = new Date();
        const candidates = await this.ticketModel.find({
            status: { $in: IDLE_TRACKED_STATUSES },
            assignedAgent: { $exists: true },
            slaPolicyId: { $exists: true },
        }).exec();

        for (const ticket of candidates) {
            const policy = await this.slaPoliciesService.findOne(ticket.slaPolicyId!.toString());
            if (!policy.idleReminder?.enabled) continue;

            const lastActivity = ticket.idleReminderState.lastReminderAt ?? ticket.lastActivityAt;
            const idleMinutes = (now.getTime() - lastActivity.getTime()) / 60_000;
            if (idleMinutes < (policy.idleReminder.intervalMinutes ?? 60)) continue;

            ticket.idleReminderState.reminderCount += 1;
            ticket.idleReminderState.lastReminderAt = now;
            ticket.history.push({
                action: 'IDLE_REMINDER_SENT',
                actorId: ticket.assignedAgent!,
                timestamp: now,
                note: `Reminder #${ticket.idleReminderState.reminderCount} — no activity for ${Math.round(idleMinutes)} minute(s)`,
            });

            await this.notificationsService.notify(
                ticket.assignedAgent!.toString(),
                'TICKET_IDLE_REMINDER',
                ticket._id.toString(),
                'Ticket',
                `Reminder: ${ticket.ticketNumber} needs attention`,
                `No activity for ${Math.round(idleMinutes)} minute(s).`,
            );

            const escalateAfter = policy.idleReminder.escalateAfterReminders ?? 3;
            if (ticket.idleReminderState.reminderCount % escalateAfter === 0) {
                const managerIds = await this.resolveRecipients(ticket, 'DEPT_MANAGER');
                await Promise.all(
                    managerIds.map((userId) =>
                        this.notificationsService.notify(
                            userId,
                            'TICKET_IDLE_ESCALATION',
                            ticket._id.toString(),
                            'Ticket',
                            `Escalation: ${ticket.ticketNumber} idle for ${ticket.idleReminderState.reminderCount} reminders`,
                            ticket.title,
                        ),
                    ),
                );
            }

            await ticket.save();
        }
    }
}