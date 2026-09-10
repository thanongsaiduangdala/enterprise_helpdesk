import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { TicketsModule } from '../tickets/tickets.module';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AnnouncementsModule } from '../announcements/announcements.module';
import { ReportsModule } from '../reports/reports.module';

@Module({
    imports: [
        TicketsModule,
        UsersModule,
        NotificationsModule,
        AnnouncementsModule,
        ReportsModule,
    ],
    controllers: [DashboardController],
    providers: [DashboardService],
})
export class DashboardModule { }
