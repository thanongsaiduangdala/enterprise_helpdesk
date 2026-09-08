import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { RolesModule } from '../roles/roles.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MailModule } from '../mail/mail.module';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
        RolesModule,
        AuditLogsModule,
        MailModule, // needed for bulk-import's "here's your temp password" email
    ],
    controllers: [UsersController],
    providers: [UsersService],
    exports: [UsersService],
})
export class UsersModule { }
