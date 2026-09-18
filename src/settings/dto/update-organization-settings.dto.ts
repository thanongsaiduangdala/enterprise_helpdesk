import { Type } from 'class-transformer';
import {
    IsArray,
    IsBoolean,
    IsNotEmpty,
    IsNumber,
    IsObject,
    IsOptional,
    IsString,
    ValidateNested,
} from 'class-validator';
import { IntegrationSetting, S3Settings, SmtpSettings } from '../schemas/organization-settings.schema';

class SmtpSettingsDto implements SmtpSettings {
    @IsOptional() @IsString() host?: string;
    @IsOptional() @IsNumber() port?: number;
    @IsOptional() @IsBoolean() secure?: boolean;
    @IsOptional() @IsString() user?: string;
    @IsOptional() @IsString() pass?: string;
    @IsOptional() @IsString() fromEmail?: string;
    @IsOptional() @IsString() fromName?: string;
}

class S3SettingsDto implements S3Settings {
    @IsOptional() @IsString() endpoint?: string;
    @IsOptional() @IsString() region?: string;
    @IsOptional() @IsString() bucket?: string;
    @IsOptional() @IsString() accessKeyId?: string;
    @IsOptional() @IsString() secretAccessKey?: string;
    @IsOptional() @IsBoolean() usePathStyle?: boolean;
}

class IntegrationSettingDto implements IntegrationSetting {
    @IsNotEmpty() @IsString() key!: string;
    @IsOptional() @IsString() label?: string;
    @IsOptional() @IsString() value?: string;
    @IsOptional() @IsBoolean() secret?: boolean;
    @IsOptional() @IsBoolean() enabled?: boolean;
}

export class UpdateOrganizationSettingsDto {
    @IsOptional() @IsString() systemName?: string;

    @IsOptional() @IsObject() @ValidateNested() @Type(() => SmtpSettingsDto)
    smtp?: SmtpSettingsDto;

    @IsOptional() @IsObject() @ValidateNested() @Type(() => S3SettingsDto)
    s3?: S3SettingsDto;

    @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => IntegrationSettingDto)
    integrations?: IntegrationSettingDto[];
}