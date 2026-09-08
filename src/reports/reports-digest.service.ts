import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReportsService } from './reports.service';
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
        const roles = await this.rolesService.findRolesWithPermission('reports', 'read');
        const roleIds = roles.map((r) => r._id);
        if (!roleIds.length) {
            this.logger.warn('No roles have reports:read permission — nobody to send the digest to.');
            return { sent: 0 };
        }

        const recipients = await this.usersService.findActiveByRoleIds(roleIds);
        if (!recipients.length) {
            this.logger.warn('No active users hold a role with reports:read permission.');
            return { sent: 0 };
        }

        const summary = await this.reportsService.fullSummary();
        const html = this.buildDigestHtml(summary);

        const slaRows = summary.sla.trend.map((t) => ({ year: t.year, week: t.week, met: t.met, breached: t.breached }));
        const pdfBuffer = await rowsToPdfBuffer('Weekly SLA Compliance Summary', slaRows);

        await Promise.all(
            recipients.map((user) =>
                this.mailService.sendMail(
                    user.email,
                    'Weekly Helpdesk Report Digest',
                    html,
                    [{ filename: 'sla-summary.pdf', content: pdfBuffer }],
                ),
            ),
        );

        this.logger.log(`Weekly digest sent to ${recipients.length} recipient(s).`);
        return { sent: recipients.length };
    }

    private buildDigestHtml(summary: Awaited<ReturnType<ReportsService['fullSummary']>>): string {
        const { sla, workload, csat } = summary;
        const topAgents = workload.slice(0, 5)
            .map((w: any) => `<li>${w._id}: ${w.totalAssigned} tickets, ${w.resolved} resolved</li>`)
            .join('');
        const csatByDept = csat.byDepartment
            .map((c: any) => `<li>${c._id}: avg ${c.avgRating?.toFixed(2) ?? 'N/A'} (${c.count} ratings)</li>`)
            .join('');

        return `
            <h2>Weekly Helpdesk Report Digest</h2>
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
