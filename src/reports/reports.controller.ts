import { Controller, Get, Post, Query, Res, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { ReportsDigestService } from './reports-digest.service';
import { toCsv } from './csv.util';
import { rowsToPdfBuffer } from './pdf.util';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

const REPORT_TITLES: Record<string, string> = {
    sla: 'SLA Compliance Report',
    tickets: 'Tickets Breakdown Report',
    workload: 'Agent Workload Report',
    csat: 'CSAT Trend Report',
};

@Controller('reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ReportsController {
    constructor(
        private reportsService: ReportsService,
        private reportsDigestService: ReportsDigestService,
    ) { }

    @Post('send-digest-now')
    @RequirePermission('reports', 'export')
    triggerDigest() {
        return this.reportsDigestService.runDigest();
    }

    @Get('sla-compliance')
    @RequirePermission('reports', 'read')
    @ApiQuery({ name: 'from', required: false, description: 'ISO date' })
    @ApiQuery({ name: 'to', required: false, description: 'ISO date' })
    slaCompliance(@Query('from') from?: string, @Query('to') to?: string) {
        return this.reportsService.slaComplianceReport(
            from ? new Date(from) : undefined,
            to ? new Date(to) : undefined,
        );
    }

    @Get('tickets-breakdown')
    @RequirePermission('reports', 'read')
    ticketsBreakdown() {
        return this.reportsService.ticketsBreakdown();
    }

    @Get('agent-workload')
    @RequirePermission('reports', 'read')
    agentWorkload() {
        return this.reportsService.agentWorkload();
    }

    @Get('csat-trend')
    @RequirePermission('reports', 'read')
    csatTrend() {
        return this.reportsService.csatTrend();
    }

    @Get('summary')
    @RequirePermission('reports', 'read')
    summary() {
        return this.reportsService.fullSummary();
    }

    // Exportable reports (CSV). Uses @Res() to bypass the global ResponseInterceptor's
    // JSON-wrapping, since a file download must NOT be wrapped in { response, msg, data }.
    @Get('export/csv')
    @RequirePermission('reports', 'export')
    @ApiQuery({ name: 'type', enum: ['sla', 'tickets', 'workload', 'csat'] })
    async exportCsv(@Query('type') type: string, @Res() res: Response) {
        if (!REPORT_TITLES[type]) {
            throw new BadRequestException(`type must be one of: ${Object.keys(REPORT_TITLES).join(', ')}`);
        }
        const rows = await this.reportsService.getFlatRows(type as any);
        const csv = toCsv(rows);

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${type}-report.csv"`);
        res.send(csv);
    }

    // Exportable reports (PDF). Same @Res() bypass reasoning as the CSV export above.
    @Get('export/pdf')
    @RequirePermission('reports', 'export')
    @ApiQuery({ name: 'type', enum: ['sla', 'tickets', 'workload', 'csat'] })
    async exportPdf(@Query('type') type: string, @Res() res: Response) {
        if (!REPORT_TITLES[type]) {
            throw new BadRequestException(`type must be one of: ${Object.keys(REPORT_TITLES).join(', ')}`);
        }
        const rows = await this.reportsService.getFlatRows(type as any);
        const buffer = await rowsToPdfBuffer(REPORT_TITLES[type], rows);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${type}-report.pdf"`);
        res.send(buffer);
    }
}
