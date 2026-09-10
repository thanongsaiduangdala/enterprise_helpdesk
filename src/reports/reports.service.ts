import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Ticket, TicketDocument, TicketStatus } from '../tickets/schemas/ticket.schema';
import { Department, DepartmentDocument } from '../departments/schemas/department.schema';
import { Branch, BranchDocument } from '../branches/schemas/branch.schema';
import { TicketType, TicketTypeDocument } from '../ticket-types/schemas/ticket-type.schema';
import { User, UserDocument } from '../users/schemas/user.schema';

export type ReportScope = { departmentId?: string; branchId?: string };

@Injectable()
export class ReportsService {
    constructor(
        @InjectModel(Ticket.name) private ticketModel: Model<TicketDocument>,
        @InjectModel(Department.name) private departmentModel: Model<DepartmentDocument>,
        @InjectModel(Branch.name) private branchModel: Model<BranchDocument>,
        @InjectModel(TicketType.name) private ticketTypeModel: Model<TicketTypeDocument>,
        @InjectModel(User.name) private userModel: Model<UserDocument>,
    ) { }

    parseDateRange(from?: string, to?: string): { from?: Date; to?: Date } {
        const parsed: { from?: Date; to?: Date } = {};
        if (from) {
            const d = new Date(from);
            if (isNaN(d.getTime())) throw new BadRequestException(`"from" is not a valid date: ${from}`);
            parsed.from = d;
        }
        if (to) {
            const d = new Date(to);
            if (isNaN(d.getTime())) throw new BadRequestException(`"to" is not a valid date: ${to}`);
            parsed.to = d;
        }
        return parsed;
    }

    private scopeMatch(scope?: ReportScope): Record<string, any> {
        if (scope?.departmentId) return { departmentId: scope.departmentId };
        if (scope?.branchId) return { branchId: scope.branchId };
        return {};
    }

    async scopeLabel(scope?: ReportScope): Promise<string> {
        if (scope?.departmentId) {
            const department = await this.departmentModel.findById(scope.departmentId).exec();
            return `Department: ${department?.name ?? scope.departmentId}`;
        }
        if (scope?.branchId) {
            const branch = await this.branchModel.findById(scope.branchId).exec();
            return `Branch: ${branch?.name ?? scope.branchId}`;
        }
        return 'Company-wide';
    }

    private async nameMap(
        model: Model<any>,
        ids: Array<string | undefined | null>,
        getName: (doc: any) => string,
    ): Promise<Map<string, string>> {
        const uniqueIds = [...new Set(ids.filter((id): id is string => !!id).map((id) => id.toString()))];
        if (!uniqueIds.length) return new Map();
        const docs = await model.find({ _id: { $in: uniqueIds } }).exec();
        return new Map(docs.map((d: any) => [d._id.toString(), getName(d)]));
    }

    private withName<T extends { _id: any; count?: number }>(
        rows: T[],
        names: Map<string, string>,
        fallback: string,
    ): Array<{ id: string; name: string } & Omit<T, '_id'>> {
        return rows.map(({ _id, ...rest }) => {
            const id = _id?.toString() ?? '';
            return { id, name: names.get(id) ?? fallback, ...rest };
        });
    }

    async slaComplianceReport(from?: Date, to?: Date, scope?: ReportScope) {
        const match: any = { ...this.scopeMatch(scope) };
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

    async ticketsBreakdown(scope?: ReportScope) {
        const match = this.scopeMatch(scope);
        const [byDepartmentRaw, byBranchRaw, byTypeRaw, byAgentRaw] = await Promise.all([
            this.ticketModel.aggregate([{ $match: match }, { $group: { _id: '$departmentId', count: { $sum: 1 } } }]),
            this.ticketModel.aggregate([{ $match: match }, { $group: { _id: '$branchId', count: { $sum: 1 } } }]),
            this.ticketModel.aggregate([{ $match: match }, { $group: { _id: '$ticketTypeId', count: { $sum: 1 } } }]),
            this.ticketModel.aggregate([
                { $match: { ...match, assignedAgent: { $exists: true } } },
                { $group: { _id: '$assignedAgent', count: { $sum: 1 } } },
            ]),
        ]);

        const [departmentNames, branchNames, typeNames, agentNames] = await Promise.all([
            this.nameMap(this.departmentModel, byDepartmentRaw.map((r) => r._id), (d) => d.name),
            this.nameMap(this.branchModel, byBranchRaw.map((r) => r._id), (b) => b.name),
            this.nameMap(this.ticketTypeModel, byTypeRaw.map((r) => r._id), (t) => t.name),
            this.nameMap(this.userModel, byAgentRaw.map((r) => r._id), (u) => `${u.firstName} ${u.lastName}`),
        ]);

        return {
            byDepartment: this.withName(byDepartmentRaw, departmentNames, 'Unknown department'),
            byBranch: this.withName(byBranchRaw, branchNames, 'Unknown branch'),
            byType: this.withName(byTypeRaw, typeNames, 'Unknown type'),
            byAgent: this.withName(byAgentRaw, agentNames, 'Unknown agent'),
        };
    }

    async agentWorkload(scope?: ReportScope) {
        const match = { ...this.scopeMatch(scope), assignedAgent: { $exists: true } };
        const rows = await this.ticketModel.aggregate([
            { $match: match },
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
                                { $ifNull: ['$resolvedAt', false] },
                                { $divide: [{ $subtract: ['$resolvedAt', '$createdAt'] }, 60000] },
                                null,
                            ],
                        },
                    },
                },
            },
            { $sort: { totalAssigned: -1 } },
        ]);

        const agentNames = await this.nameMap(this.userModel, rows.map((r) => r._id), (u) => `${u.firstName} ${u.lastName}`);
        return this.withName(rows, agentNames, 'Unknown agent');
    }

    async csatTrend(scope?: ReportScope) {
        const match = { ...this.scopeMatch(scope), 'csat.rating': { $exists: true } };
        const [byAgentRaw, byDepartmentRaw] = await Promise.all([
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

        const [agentNames, departmentNames] = await Promise.all([
            this.nameMap(this.userModel, byAgentRaw.map((r) => r._id), (u) => `${u.firstName} ${u.lastName}`),
            this.nameMap(this.departmentModel, byDepartmentRaw.map((r) => r._id), (d) => d.name),
        ]);

        return {
            byAgent: this.withName(byAgentRaw, agentNames, 'Unknown agent'),
            byDepartment: this.withName(byDepartmentRaw, departmentNames, 'Unknown department'),
        };
    }

    async fullSummary(scope?: ReportScope) {
        const [sla, tickets, workload, csat] = await Promise.all([
            this.slaComplianceReport(undefined, undefined, scope),
            this.ticketsBreakdown(scope),
            this.agentWorkload(scope),
            this.csatTrend(scope),
        ]);
        return { sla, tickets, workload, csat };
    }

    async getFlatRows(
        type: 'sla' | 'tickets' | 'workload' | 'csat',
        from?: Date,
        to?: Date,
        scope?: ReportScope,
    ): Promise<Record<string, any>[]> {
        switch (type) {
            case 'sla': {
                const r = await this.slaComplianceReport(from, to, scope);
                return r.trend.map((t) => ({ year: t.year, week: t.week, met: t.met, breached: t.breached }));
            }
            case 'tickets': {
                const r = await this.ticketsBreakdown(scope);
                return [
                    ...r.byDepartment.map((x) => ({ group: 'department', id: x.id, name: x.name, count: x.count })),
                    ...r.byBranch.map((x) => ({ group: 'branch', id: x.id, name: x.name, count: x.count })),
                    ...r.byType.map((x) => ({ group: 'type', id: x.id, name: x.name, count: x.count })),
                    ...r.byAgent.map((x) => ({ group: 'agent', id: x.id, name: x.name, count: x.count })),
                ];
            }
            case 'workload': {
                return this.agentWorkload(scope);
            }
            case 'csat': {
                const r = await this.csatTrend(scope);
                return [
                    ...r.byAgent.map((x) => ({ group: 'agent', id: x.id, name: x.name, avgRating: x.avgRating, count: x.count })),
                    ...r.byDepartment.map((x) => ({ group: 'department', id: x.id, name: x.name, avgRating: x.avgRating, count: x.count })),
                ];
            }
        }
    }
}