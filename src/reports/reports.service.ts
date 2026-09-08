import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Ticket, TicketDocument, TicketStatus } from '../tickets/schemas/ticket.schema';

@Injectable()
export class ReportsService {
    constructor(
        @InjectModel(Ticket.name) private ticketModel: Model<TicketDocument>,
    ) { }

    // 1. SLA compliance — met vs breached, trend over time (grouped by ISO week).
    async slaComplianceReport(from?: Date, to?: Date) {
        const match: any = {};
        if (from || to) {
            match.createdAt = {};
            if (from) match.createdAt.$gte = from;
            if (to) match.createdAt.$lte = to;
        }

        const totals = await this.ticketModel.aggregate([
            { $match: match },
            { $group: { _id: '$sla.breached', count: { $sum: 1 } } },
        ]);
        const met = totals.find((t) => t._id === false)?.count ?? 0;
        const breached = totals.find((t) => t._id === true)?.count ?? 0;

        const trend = await this.ticketModel.aggregate([
            { $match: match },
            {
                $group: {
                    _id: { year: { $year: '$createdAt' }, week: { $week: '$createdAt' } },
                    met: { $sum: { $cond: [{ $eq: ['$sla.breached', false] }, 1, 0] } },
                    breached: { $sum: { $cond: [{ $eq: ['$sla.breached', true] }, 1, 0] } },
                },
            },
            { $sort: { '_id.year': 1, '_id.week': 1 } },
        ]);

        return {
            met,
            breached,
            complianceRate: met + breached > 0 ? Number((met / (met + breached)).toFixed(4)) : null,
            trend: trend.map((t) => ({ year: t._id.year, week: t._id.week, met: t.met, breached: t.breached })),
        };
    }

    // 2. Tickets by department / branch / type / agent — simple grouped counts.
    async ticketsBreakdown() {
        const [byDepartment, byBranch, byType, byAgent] = await Promise.all([
            this.ticketModel.aggregate([{ $group: { _id: '$departmentId', count: { $sum: 1 } } }]),
            this.ticketModel.aggregate([{ $group: { _id: '$branchId', count: { $sum: 1 } } }]),
            this.ticketModel.aggregate([{ $group: { _id: '$ticketTypeId', count: { $sum: 1 } } }]),
            this.ticketModel.aggregate([
                { $match: { assignedAgent: { $exists: true } } },
                { $group: { _id: '$assignedAgent', count: { $sum: 1 } } },
            ]),
        ]);
        return { byDepartment, byBranch, byType, byAgent };
    }

    // 3. Agent workload & performance.
    // NOTE on avgResolutionMinutes: there's no dedicated `resolvedAt` field on Ticket,
    // so this uses `updatedAt` as a proxy for "when it was last touched" among
    // resolved/closed tickets. It's an approximation, not exact — a ticket touched after
    // being resolved (e.g. a late comment) would skew this. A precise version would scan
    // `history` for the STATUS_CHANGED entry into RESOLVED, which is a heavier query.
    async agentWorkload() {
        return this.ticketModel.aggregate([
            { $match: { assignedAgent: { $exists: true } } },
            {
                $group: {
                    _id: '$assignedAgent',
                    totalAssigned: { $sum: 1 },
                    resolved: {
                        $sum: { $cond: [{ $in: ['$status', [TicketStatus.RESOLVED, TicketStatus.CLOSED]] }, 1, 0] },
                    },
                    avgResolutionMinutes: {
                        $avg: {
                            $cond: [
                                { $in: ['$status', [TicketStatus.RESOLVED, TicketStatus.CLOSED]] },
                                { $divide: [{ $subtract: ['$updatedAt', '$createdAt'] }, 60000] },
                                null,
                            ],
                        },
                    },
                },
            },
            { $sort: { totalAssigned: -1 } },
        ]);
    }

    // 4. CSAT trend — average rating by agent / department.
    async csatTrend() {
        const match = { 'csat.rating': { $exists: true } };
        const [byAgent, byDepartment] = await Promise.all([
            this.ticketModel.aggregate([
                { $match: match },
                { $group: { _id: '$assignedAgent', avgRating: { $avg: '$csat.rating' }, count: { $sum: 1 } } },
                { $sort: { avgRating: -1 } },
            ]),
            this.ticketModel.aggregate([
                { $match: match },
                { $group: { _id: '$departmentId', avgRating: { $avg: '$csat.rating' }, count: { $sum: 1 } } },
                { $sort: { avgRating: -1 } },
            ]),
        ]);
        return { byAgent, byDepartment };
    }

    // Bundles all four for the digest email / a combined export.
    async fullSummary() {
        const [sla, tickets, workload, csat] = await Promise.all([
            this.slaComplianceReport(),
            this.ticketsBreakdown(),
            this.agentWorkload(),
            this.csatTrend(),
        ]);
        return { sla, tickets, workload, csat };
    }

    // Flattens one report type into rows suitable for CSV/PDF export.
    async getFlatRows(type: 'sla' | 'tickets' | 'workload' | 'csat'): Promise<Record<string, any>[]> {
        switch (type) {
            case 'sla': {
                const r = await this.slaComplianceReport();
                return r.trend.map((t) => ({ year: t.year, week: t.week, met: t.met, breached: t.breached }));
            }
            case 'tickets': {
                const r = await this.ticketsBreakdown();
                return [
                    ...r.byDepartment.map((x) => ({ group: 'department', key: x._id, count: x.count })),
                    ...r.byBranch.map((x) => ({ group: 'branch', key: x._id, count: x.count })),
                    ...r.byType.map((x) => ({ group: 'type', key: x._id, count: x.count })),
                    ...r.byAgent.map((x) => ({ group: 'agent', key: x._id, count: x.count })),
                ];
            }
            case 'workload': {
                return this.agentWorkload();
            }
            case 'csat': {
                const r = await this.csatTrend();
                return [
                    ...r.byAgent.map((x) => ({ group: 'agent', key: x._id, avgRating: x.avgRating, count: x.count })),
                    ...r.byDepartment.map((x) => ({ group: 'department', key: x._id, avgRating: x.avgRating, count: x.count })),
                ];
            }
        }
    }
}
