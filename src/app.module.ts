import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { RolesModule } from './roles/roles.module';
import { TicketTypesModule } from './ticket-types/ticket-type.module';
import { BranchesModule } from './branches/branches.module';
import { SessionsModule } from './sessions/sessions.module';
import { LoggerMiddleware } from './common/middleware/logger.middleware';
import { RoomsModule } from './rooms/rooms.module';
import { RoomBookingsModule } from './room-bookings/room-bookings.module';
import { SupplyCatalogModule } from './supply-catalog/supply-catalog.module';
import { SupplyRequestsModule } from './supply-requests/supply-requests.module';
import { CannedResponsesModule } from './canned-responses/canned-responses.module';
import { TicketMessagesModule } from './ticket-messages/ticket-messages.module';
import { AssetsModule } from './assets/assets.module';
import { KbArticlesModule } from './kb-articles/kb-articles.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { TicketsModule } from './tickets/tickets.module';
import { SlaPoliciesModule } from './sla-policies/sla-policies.module';
import { DepartmentsModule } from './departments/departments.module';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRoot(process.env.MONGODB_URI as string),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    RolesModule,
    UsersModule,
    AuthModule,
    TicketTypesModule,
    SlaPoliciesModule,
    BranchesModule,
    DepartmentsModule,
    SessionsModule,
    RoomsModule,
    RoomBookingsModule,
    SupplyCatalogModule,
    SupplyRequestsModule,
    CannedResponsesModule,
    TicketMessagesModule,
    AssetsModule,
    KbArticlesModule,
    AnnouncementsModule,
    NotificationsModule,
    AuditLogsModule,
    TicketsModule,
  ],

  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}