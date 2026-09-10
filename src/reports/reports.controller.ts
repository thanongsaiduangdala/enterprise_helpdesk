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
        const range = this.reportsService.parseDateRange(from, to);
        return this.reportsService.slaComplianceReport(range.from, range.to);
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

    @Get('export/csv')
    @RequirePermission('reports', 'export')
    @ApiQuery({ name: 'type', enum: ['sla', 'tickets', 'workload', 'csat'] })
    @ApiQuery({ name: 'from', required: false, description: 'ISO date — only applies to type=sla' })
    @ApiQuery({ name: 'to', required: false, description: 'ISO date — only applies to type=sla' })
    async exportCsv(
        @Query('type') type: string,
        @Query('from') from: string | undefined,
        @Query('to') to: string | undefined,
        @Res() res: Response,
    ) {
        if (!REPORT_TITLES[type]) {
            throw new BadRequestException(`type must be one of: ${Object.keys(REPORT_TITLES).join(', ')}`);
        }
        const range = this.reportsService.parseDateRange(from, to);
        const rows = await this.reportsService.getFlatRows(type as any, range.from, range.to);
        const csv = toCsv(rows);

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${type}-report.csv"`);
        res.send(csv);
    }

    @Get('export/pdf')
    @RequirePermission('reports', 'export')
    @ApiQuery({ name: 'type', enum: ['sla', 'tickets', 'workload', 'csat'] })
    @ApiQuery({ name: 'from', required: false, description: 'ISO date — only applies to type=sla' })
    @ApiQuery({ name: 'to', required: false, description: 'ISO date — only applies to type=sla' })
    async exportPdf(
        @Query('type') type: string,
        @Query('from') from: string | undefined,
        @Query('to') to: string | undefined,
        @Res() res: Response,
    ) {
        if (!REPORT_TITLES[type]) {
            throw new BadRequestException(`type must be one of: ${Object.keys(REPORT_TITLES).join(', ')}`);
        }
        const range = this.reportsService.parseDateRange(from, to);
        const rows = await this.reportsService.getFlatRows(type as any, range.from, range.to);
        const buffer = await rowsToPdfBuffer(REPORT_TITLES[type], rows);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${type}-report.pdf"`);
        res.send(buffer);
    }
}