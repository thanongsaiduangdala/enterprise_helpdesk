import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { OrganizationSettingsService } from './organization-settings.service';
import { UpdateOrganizationSettingsDto } from './dto/update-organization-settings.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

@Controller('settings/org')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class OrganizationSettingsController {
    constructor(private settingsService: OrganizationSettingsService) { }

    @Get()
    @RequirePermission('settings', 'read')
    getSettings() {
        return this.settingsService.getSettings();
    }

    @Patch()
    @RequirePermission('settings', 'update')
    updateSettings(@Body() dto: UpdateOrganizationSettingsDto, @Req() req: any) {
        return this.settingsService.update(dto);
    }
}