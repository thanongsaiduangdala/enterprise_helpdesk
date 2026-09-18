import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
    OrganizationSettings,
    OrganizationSettingsSchema,
} from './schemas/organization-settings.schema';
import { OrganizationSettingsService } from './organization-settings.service';
import { OrganizationSettingsController } from './organization-settings.controller';
import { PublicSettingsController } from './public-settings.controller';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: OrganizationSettings.name, schema: OrganizationSettingsSchema },
        ]),
    ],
    controllers: [OrganizationSettingsController, PublicSettingsController],
    providers: [OrganizationSettingsService],
    exports: [OrganizationSettingsService],
})
export class SettingsModule { }