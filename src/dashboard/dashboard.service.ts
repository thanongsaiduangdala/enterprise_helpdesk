import { Injectable } from '@nestjs/common';
import { TicketsService } from '../tickets/tickets.service';
import { TicketDocument, TicketStatus } from '../tickets/schemas/ticket.schema';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AnnouncementsService } from '../announcements/announcements.service';
import { ReportsService, ReportScope } from '../reports/reports.service';

const DUE_SOON_WINDOW_MS = 4 * 60 * 60 * 1000; // tickets due within 4h are flagged as "due soon"
const RECENT_NOTIFICATIONS_LIMIT = 10;
const RECENT_ANNOUNCEMENTS_LIMIT = 10;
const RECENT_TICKETS_LIMIT = 5;

interface PermissionEntry {
    module: string;
    actions: string[];
}

@Injectable()
export class DashboardService {
    constructor(
        private ticketsService: TicketsService,
        private usersService: UsersService,
        private notificationsService: NotificationsService,
        private announcementsService: AnnouncementsService,
        private reportsService: ReportsService,
    ) { }

    private hasPermission(permissions: PermissionEntry[] | undefined, module: string, action: string): boolean {
        return (permissions ?? []).some((p) => p.module === module && p.actions.includes(action));
    }

    private summarizeTickets(tickets: TicketDocument[]) {
        const byStatus: Record<string, number> = {};
        for (const status of Object.values(TicketStatus)) byStatus[status] = 0;

        let slaBreached = 0;
        let slaDueSoon = 0;
        const now = Date.now();

        for (const ticket of tickets) {
            byStatus[ticket.status] = (byStatus[ticket.status] ?? 0) + 1;

            if (ticket.sla?.breached) {
                slaBreached++;
            } else if (ticket.sla?.resolutionDueAt) {
                const dueInMs = new Date(ticket.sla.resolutionDueAt).getTime() - now;
                if (dueInMs > 0 && dueInMs <= DUE_SOON_WINDOW_MS) slaDueSoon++;
            }
        }

        return {
            total: tickets.length,
            byStatus,
            slaBreached,
            slaDueSoon,
            recent: tickets.slice(0, RECENT_TICKETS_LIMIT).map((t) => ({
                id: t._id,
                ticketNumber: t.ticketNumber,
                title: t.title,
                status: t.status,
                priority: t.priority,
                resolutionDueAt: t.sla?.resolutionDueAt,
                slaBreached: t.sla?.breached ?? false,
            })),
        };
    }

    /**
     * Best-effort mapping from role name to a reporting scope, following the
     * same role-name convention already used in SlaMonitorService (e.g.
     * 'DEPT_MANAGER'). Role names are free text in this system, so any role
     * that doesn't match one of these falls back to company-wide (SUPER_ADMIN,
     * AUDITOR, or anything custom).
     */
    private resolveReportScope(roleName: string | undefined, user: any): ReportScope | undefined {
        if (roleName === 'DEPT_MANAGER' && user.departmentId) return { departmentId: user.departmentId };
        if (roleName === 'BRANCH_ADMIN' && user.branchId) return { branchId: user.branchId };
        return undefined;
    }

    async getDashboard(userId: string) {
        const user = await this.usersService.findOne(userId);
        const role = user.role as any;
        const permissions: PermissionEntry[] = role?.permissions ?? [];

        const canAssignTickets = this.hasPermission(permissions, 'tickets', 'assign');
        const canReadReports = this.hasPermission(permissions, 'reports', 'read');

        const [myTicketsRaw, unreadCount, activeAnnouncements, recentNotifications] = await Promise.all([
            this.ticketsService.findMine(userId),
            this.notificationsService.unreadCount(userId),
            this.announcementsService.findActiveForUser(userId),
            this.notificationsService.findMine(userId),
        ]);

        const myTickets = this.summarizeTickets(myTicketsRaw as TicketDocument[]);

        let assignedToMe: ReturnType<DashboardService['summarizeTickets']> | undefined;
        if (canAssignTickets) {
            const assignedRaw = await this.ticketsService.findAssignedToMe(userId);
            assignedToMe = this.summarizeTickets(assignedRaw as TicketDocument[]);
        }

        let teamOverview: Record<string, any> | undefined;
        let orgStats: Record<string, any> | undefined;
        if (canReadReports) {
            const scope = this.resolveReportScope(role?.name, user);
            const [scopeLabel, breakdown, sla] = await Promise.all([
                this.reportsService.scopeLabel(scope),
                this.reportsService.ticketsBreakdown(scope),
                this.reportsService.slaComplianceReport(undefined, undefined, scope),
            ]);
            const stats = { scopeLabel, breakdown, sla };

            if (role?.name === 'DEPT_MANAGER') {
                teamOverview = stats;
            } else {
                orgStats = stats;
            }
        }

        return {
            user: {
                id: user._id,
                firstName: user.firstName,
                lastName: user.lastName,
                role: role?.name,
            },
            myTickets,
            assignedToMe,
            teamOverview,
            orgStats,
            notifications: {
                unreadCount,
                recent: recentNotifications.slice(0, RECENT_NOTIFICATIONS_LIMIT),
            },
            announcements: {
                pinned: activeAnnouncements.filter((a: any) => a.pinned),
                recent: activeAnnouncements.slice(0, RECENT_ANNOUNCEMENTS_LIMIT),
            },
        };
    }
}
