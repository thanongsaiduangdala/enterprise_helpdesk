import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type OrganizationSettingsDocument = OrganizationSettings & Document;

export interface IntegrationSetting {
  key: string;
  label?: string;
  value?: string;
  secret?: boolean;
  enabled?: boolean;
}

export interface SmtpSettings {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  fromEmail?: string;
  fromName?: string;
}

export interface S3Settings {
  endpoint?: string;
  region?: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  usePathStyle?: boolean;
}

// ຊື່ທີ່ໃຊ້ແທນຄ່າລັບ ຢູ່ໃນ response GET ເພື່ອບໍ່ໃຫ້ຄ່າລັບຮົ່ວອອກໄປ  —
// ຕອນແກ້ໄຂ ຖ້າສົ່ງຄ່ານີ້ຄືນ (ຫຼືສົ່ງຄ່າເປົ່າ) ລະບົບຈະ "ຮັກສາຄ່າເກົ່າໄວ້"
export const SECRET_MASK = '••••••••';

// ບໍ່ໃຊ້ໄລຍະຫວ່າງ/ຕິດຕໍ່ກັນ — ຈະເກັບຮັກສາເປັນເອກະສານດຽວ ແບບ singleton ທັງອົງກອນ
export const ORG_SETTINGS_ID = 'org';

@Schema({ timestamps: true, collection: 'organizationsettings' })
export class OrganizationSettings {
  @Prop({ type: String })
  _id!: string;

  @Prop({ default: 'Helpdesk Enterprise' })
  systemName!: string;

  @Prop({ type: Object })
  smtp?: SmtpSettings;

  @Prop({ type: Object })
  s3?: S3Settings;

  @Prop({ type: Array, default: [] })
  integrations?: IntegrationSetting[];

  /**
   * ແຍກໜ້າທີ່ (segregation of duties) — ຄົນດຽວບໍ່ສາມາດເຮັດສອງຂັ້ນຕອນຕິດກັນ.
   *
   * ບໍ່ຕັ້ງ default ໄວ້ໃນ schema ຢ່າງສະຄັນ: ຄ່າ "ບໍ່ໄດ້ຕັ້ງ" ຕ້ອງເປັນ undefined
   * ເພື່ອໃຫ້ chain ລຳດັບ (settings → SOD_ENFORCE → NODE_ENV) ເຮັດວຽກໄດ້. ຖ້າມີ default:true
   * Mongoose ຈະ apply ໃສ່ doc ທີ່ hydrate ຈາກ DB → env fallback ຈະບໍ່ເຄີັດໃຊ້.
   * ຄ່າທີ່ມີຜົນຈິງ = ຄ່າທີ່ admin ຕັ້ງຢ່າງເຈີງ (true/false).
   */
  @Prop({ type: Boolean })
  sodEnforce?: boolean;
}

export const OrganizationSettingsSchema =
  SchemaFactory.createForClass(OrganizationSettings);
