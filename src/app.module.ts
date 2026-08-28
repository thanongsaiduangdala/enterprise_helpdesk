import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { RolesModule } from './roles/roles.module';
import { TicketTypesModule } from './ticket-types/ticket-type.module';
import { SlaPoliciesModule } from './sla_policy/sla-policies.module';
import { BranchesModule } from './branches/branches.module';
import { DepartmentsModule } from './department/departments.module';
import { SessionsModule } from './sessions/sessions.module';
import { LoggerMiddleware } from './common/middleware/logger.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRoot(process.env.MONGODB_URI as string),
    RolesModule,
    UsersModule,
    AuthModule,
    TicketTypesModule,
    SlaPoliciesModule,
    BranchesModule,
    DepartmentsModule,
    SessionsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}