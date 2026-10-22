import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { OrganizationSettingsService } from './organization-settings.service';
import { UpdateOrganizationSettingsDto } from './dto/update-organization-settings.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { SUPER_ADMIN_ROLE } from '../common/utils/permission.util';

@Controller('settings/org')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class OrganizationSettingsController {
  constructor(private settingsService: OrganizationSettingsService) {}

  @Get()
  @RequirePermission('settings', 'read')
  getSettings() {
    return this.settingsService.getSettings();
  }

  @Patch()
  @RequirePermission('settings', 'update')
  updateSettings(@Body() dto: UpdateOrganizationSettingsDto, @Req() req: any) {
    // ສະລິດ SoD ເປັນຕົດະຄວາມປອດໄພ (security control) → ຈຳກັດໃຫ້ SUPER_ADMIN ເທົ່ານັ້ນ
    if (dto.sodEnforce !== undefined && req.user?.role !== SUPER_ADMIN_ROLE) {
      throw new ForbiddenException(
        'ການປິດ/ເປີດການບັງຄັບແຍກໜ້າທີ່ (SoD) ສະເພາະ SUPER_ADMIN ເທົ່ານັ້ນ',
      );
    }
    return this.settingsService.update(dto);
  }
}
