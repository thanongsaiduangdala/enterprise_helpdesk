import { Controller, Get } from '@nestjs/common';
import { OrganizationSettingsService } from './organization-settings.service';

// ບໍ່ຕ້ອງ login ກໍ່ເຂົ້າໄດ້ — ໃຊ້ໃນໜ້າ Login / Sidebar ເພື່ອເອົາ "ຊື່ລະບົບ" ມາສະແດງ (ບໍ່ມີຂໍ້ມູນລັບ)
@Controller('settings/org/public')
export class PublicSettingsController {
    constructor(private settingsService: OrganizationSettingsService) { }

    @Get()
    getPublicSettings() {
        return this.settingsService.getPublic();
    }
}