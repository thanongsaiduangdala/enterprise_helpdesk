import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  IntegrationSetting,
  ORG_SETTINGS_ID,
  OrganizationSettings,
  OrganizationSettingsDocument,
  SECRET_MASK,
} from './schemas/organization-settings.schema';
import { UpdateOrganizationSettingsDto } from './dto/update-organization-settings.dto';
import {
  envFallback,
  invalidateSodCache,
  registerSodLoader,
} from '../common/utils/sod.util';

@Injectable()
export class OrganizationSettingsService implements OnModuleInit {
  constructor(
    @InjectModel(OrganizationSettings.name)
    private settingsModel: Model<OrganizationSettingsDocument>,
  ) {}

  onModuleInit() {
    // ລົງທະບຽນ loader ໃຫ້ sodEnforced() ອ່ານຄ່າ settings (ແຄດ TTL ຢູ່ sod.util)
    // ຄືນ undefined ເມື່ອຍັງບໍ່ໄດ້ຕັ້ງຄ່າ → ໃຫ້ env fallback ເຮັດວຽກ
    registerSodLoader(async () => (await this.getSettingsDoc()).sodEnforce);
  }

  /** ຄ່າ SoD ທີ່ໃຊ້ຈິງຈິງ: ຄ່າໃນ settings (ຖ້າຕັ້ງໄວ້) → env fallback */
  async getSodEnforce(): Promise<boolean> {
    const doc = await this.getSettingsDoc();
    return doc.sodEnforce ?? envFallback();
  }

  // ຮັບປະກັນວ່າມີ singleton ເອກະສານດຽວ (ງ່າຍຕໍ່ການໝູນໃຊ້ຂ້າມບ່ອນ)
  async getSettingsDoc(): Promise<OrganizationSettingsDocument> {
    const existing = await this.settingsModel.findById(ORG_SETTINGS_ID).exec();
    if (existing) return existing;

    try {
      const created = new this.settingsModel({
        _id: ORG_SETTINGS_ID,
        systemName: 'Helpdesk Enterprise',
        integrations: [],
      });
      return await created.save();
    } catch (err: any) {
      // ຊົນກັນຈາກ 2 instance (race) → ອີກ instance ສ້າງໄຟແລ້ວ → ອານ ເຮັດວຽກ
      if (err?.code === 11000) {
        const raced = await this.settingsModel.findById(ORG_SETTINGS_ID).exec();
        if (raced) return raced;
      }
      throw err;
    }
  }

  async getPublic(): Promise<{ systemName: string }> {
    const doc = await this.getSettingsDoc();
    return { systemName: doc.systemName };
  }

  // ຄືນຄ່າການຕັ້ງຄ່າທັງໝົດ ແຕ່ເຄື່ອງລັບຈະຖືກ mask ໄວ້
  async getSettings() {
    const doc = await this.getSettingsDoc();
    const obj: any = doc.toObject();

    if (obj.smtp?.pass) obj.smtp.pass = SECRET_MASK;
    if (obj.s3?.accessKeyId) obj.s3.accessKeyId = SECRET_MASK;
    if (obj.s3?.secretAccessKey) obj.s3.secretAccessKey = SECRET_MASK;

    if (Array.isArray(obj.integrations)) {
      obj.integrations = obj.integrations.map((it: IntegrationSetting) =>
        it.secret && it.value ? { ...it, value: SECRET_MASK } : it,
      );
    }

    // ຄືນ "ຄ່າທີ່ໃຊ້ຈິງຈິງ" ໃຫ້ client (override ຖ້າມີ, ຖ້າບໍ່ → env fallback)
    obj.sodEnforce = doc.sodEnforce ?? envFallback();
    return obj;
  }

  // ຖ້າສົ່ງຄ່າເປົ່າ ຫຼື ຄ່າ mask → ຮັກສາຄ່າເກົ່າ (ໃຫ້ຜູ້ໃຊ້ບໍ່ຈຳເປັນພິມຄ່າລັບຄືນໃໝ່ທຸກເທື່ອ)
  private resolveSecretValue(
    incoming: string | undefined,
    existing?: string,
  ): string | undefined {
    if (
      incoming === undefined ||
      incoming === null ||
      incoming === '' ||
      incoming === SECRET_MASK
    ) {
      return existing;
    }
    return incoming;
  }

  async update(dto: UpdateOrganizationSettingsDto) {
    const doc = await this.getSettingsDoc();

    if (dto.systemName !== undefined && dto.systemName !== null) {
      doc.systemName = dto.systemName.trim() || 'Helpdesk Enterprise';
    }

    if (dto.sodEnforce === null) {
      // ຍົກເຄືອນ override → ກັບໄປໃຊ້ env fallback ຕາມລຳດັບ
      doc.set('sodEnforce', undefined);
      doc.unmarkModified('sodEnforce');
    } else if (dto.sodEnforce !== undefined) {
      doc.sodEnforce = dto.sodEnforce;
    }

    if (dto.smtp !== undefined) {
      const cur = doc.smtp || {};
      doc.smtp = {
        host: dto.smtp.host ?? cur.host,
        port: dto.smtp.port ?? cur.port,
        secure: dto.smtp.secure ?? cur.secure,
        user: dto.smtp.user ?? cur.user,
        pass: this.resolveSecretValue(dto.smtp.pass, cur.pass),
        fromEmail: dto.smtp.fromEmail ?? cur.fromEmail,
        fromName: dto.smtp.fromName ?? cur.fromName,
      };
    }

    if (dto.s3 !== undefined) {
      const cur = doc.s3 || {};
      doc.s3 = {
        endpoint: dto.s3.endpoint ?? cur.endpoint,
        region: dto.s3.region ?? cur.region,
        bucket: dto.s3.bucket ?? cur.bucket,
        accessKeyId: this.resolveSecretValue(
          dto.s3.accessKeyId,
          cur.accessKeyId,
        ),
        secretAccessKey: this.resolveSecretValue(
          dto.s3.secretAccessKey,
          cur.secretAccessKey,
        ),
        usePathStyle: dto.s3.usePathStyle ?? cur.usePathStyle,
      };
    }

    if (dto.integrations !== undefined) {
      const existing = Array.isArray(doc.integrations) ? doc.integrations : [];
      doc.integrations = dto.integrations.map(
        (incoming: IntegrationSetting) => {
          const prevItem = existing.find(
            (e) => e.key.toLowerCase() === String(incoming.key).toLowerCase(),
          );
          return {
            key: incoming.key.trim(),
            label: incoming.label ?? prevItem?.label,
            value: this.resolveSecretValue(incoming.value, prevItem?.value),
            secret: incoming.secret ?? prevItem?.secret,
            enabled: incoming.enabled ?? prevItem?.enabled,
          };
        },
      );
    }

    const saved = await doc.save();
    // ໃຫ້ sodEnforced() ເຫັນຄ່າໃໝ່ທັນທີ (ບໍ່ຕ້ອງລໍ TTL)
    invalidateSodCache();
    return saved;
  }
}
