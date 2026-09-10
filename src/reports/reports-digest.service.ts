import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReportsService, ReportScope } from './reports.service';
import { RolesService } from '../roles/roles.service';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { rowsToPdfBuffer } from './pdf.util';

@Injectable()
export class ReportsDigestService {
    private readonly logger = new Logger(ReportsDigestService.name);

    constructor(
        private reportsService: ReportsService,
        private rolesService: RolesService,
        private usersService: UsersService,
        private mailService: MailService,
    ) { }


    @Cron('0 8 * * 1')
    async sendWeeklyDigest() {
        this.logger.log('Running weekly report digest...');
        await this.runDigest();
    }

    async runDigest() {
        const [readRoles, exportRoles] = await Promise.all([
            this.rolesService.findRolesWithPermission('reports', 'read'),
            this.rolesService.findRolesWithPermission('reports', 'export'),
        ]);
        const readRoleIds = readRoles.map((r) => r._id);
        const exportRoleIds = new Set(exportRoles.map((r) => r._id));
        if (!readRoleIds.length) {
            this.logger.warn('No roles have reports:read permission — nobody to send the digest to.');
            return { sent: 0 };
        }

        const recipients = await this.usersService.findActiveByRoleIds(readRoleIds);
        if (!recipients.length) {
            this.logger.warn('No active users hold a role with reports:read permission.');
            return { sent: 0 };
        }

        const groups = new Map<string, { scope?: ReportScope; recipients: typeof recipients }>();
        for (const recipient of recipients) {
            const hasFullAccess = exportRoleIds.has(recipient.role);
            const scope: ReportScope | undefined = hasFullAccess
                ? undefined
                : recipient.departmentId
                    ? { departmentId: recipient.departmentId }
                    : { branchId: recipient.branchId };
            const key = hasFullAccess ? 'full' : `${scope?.departmentId ? 'dept' : 'branch'}:${scope?.departmentId ?? scope?.branchId}`;

            const group = groups.get(key);
            if (group) {
                group.recipients.push(recipient);
            } else {
                groups.set(key, { scope, recipients: [recipient] });
            }
        }

        let sent = 0;
        for (const { scope, recipients: groupRecipients } of groups.values()) {
            const [summary, scopeLabel] = await Promise.all([
                this.reportsService.fullSummary(scope),
                this.reportsService.scopeLabel(scope),
            ]);
            const html = this.buildDigestHtml(summary, scopeLabel);

            const slaRows = summary.sla.trend.map((t) => ({ year: t.year, week: t.week, met: t.met, breached: t.breached }));
            const pdfBuffer = await rowsToPdfBuffer(`Weekly SLA Compliance Summary — ${scopeLabel}`, slaRows);

            await Promise.all(
                groupRecipients.map((user) =>
                    this.mailService.sendMail(
                        user.email,
                        `Weekly Helpdesk Report Digest — ${scopeLabel}`,
                        html,
                        [{ filename: 'sla-summary.pdf', content: pdfBuffer }],
                    ),
                ),
            );
            sent += groupRecipients.length;
        }

        this.logger.log(`Weekly digest sent to ${sent} recipient(s) across ${groups.size} scope(s).`);
        return { sent };
    }

    private buildDigestHtml(summary: Awaited<ReturnType<ReportsService['fullSummary']>>, scopeLabel: string): string {
        const { sla, workload, csat } = summary;
        const topAgents = workload.slice(0, 5)
            .map((w: any) => `<li>${w.name}: ${w.totalAssigned} tickets, ${w.resolved} resolved</li>`)
            .join('');
        const csatByDept = csat.byDepartment
            .map((c: any) => `<li>${c.name}: avg ${c.avgRating?.toFixed(2) ?? 'N/A'} (${c.count} ratings)</li>`)
            .join('');

        return `
            <h2>Weekly Helpdesk Report Digest — ${scopeLabel}</h2>
            <h3>SLA Compliance</h3>
            <p>Met: ${sla.met} | Breached: ${sla.breached} | Compliance rate: ${sla.complianceRate !== null ? (sla.complianceRate * 100).toFixed(1) + '%' : 'N/A'
            }</p>
            <h3>Top Agent Workload</h3>
            <ul>${topAgents || '<li>No assigned tickets yet.</li>'}</ul>
            <h3>CSAT by Department</h3>
            <ul>${csatByDept || '<li>No feedback submitted yet.</li>'}</ul>
            <p>Full SLA trend attached as PDF.</p>
        `;
    }
}