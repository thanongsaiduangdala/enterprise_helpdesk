import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DashboardController {
    constructor(private dashboardService: DashboardService) { }

    @Get()
    @ApiQuery({ name: 'branchId', required: false, description: 'Filter overview/report stats to a single branch' })
    getDashboard(@Req() req: any, @Query('branchId') branchId?: string) {
        return this.dashboardService.getDashboard(req.user.userId, branchId);
    }
}
