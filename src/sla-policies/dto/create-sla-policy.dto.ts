import {
    ArrayNotEmpty,
    IsArray,
    IsBoolean,
    IsIn,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    Min,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class EscalationRuleDto {
    @ApiProperty({ example: 30 })
    @IsInt()
    @Min(1)
    afterMinutesOverdue!: number;

    @ApiProperty({ example: 'DEPT_MANAGER' })
    @IsString()
    notifyRole!: string;
}

class IdleReminderDto {
    @ApiPropertyOptional({ example: true })
    @IsOptional()
    @IsBoolean()
    enabled?: boolean;

    @ApiPropertyOptional({ example: 60, description: 'Minutes between reminder nudges' })
    @IsOptional()
    @IsInt()
    @Min(1)
    intervalMinutes?: number;

    @ApiPropertyOptional({ example: 3, description: 'Escalate to manager after this many reminders' })
    @IsOptional()
    @IsInt()
    @Min(1)
    escalateAfterReminders?: number;
}

export class CreateSlaPolicyDto {
    @ApiProperty({ example: 'IT High Priority SLA' })
    @IsNotEmpty()
    name!: string;

    @ApiProperty({ example: 'TT001', description: 'A ticketTypes._id this policy applies to' })
    @IsString()
    ticketTypeId!: string;

    @ApiProperty({ example: 'high', enum: ['low', 'medium', 'high', 'urgent'] })
    @IsIn(['low', 'medium', 'high', 'urgent'])
    priority!: string;

    @ApiProperty({ example: 30 })
    @IsInt()
    @Min(1)
    responseTimeMinutes!: number;

    @ApiProperty({ example: 240 })
    @IsInt()
    @Min(1)
    resolutionTimeMinutes!: number;

    @ApiPropertyOptional({ type: [EscalationRuleDto] })
    @IsOptional()
    @IsArray()
    @ArrayNotEmpty()
    @ValidateNested({ each: true })
    @Type(() => EscalationRuleDto)
    escalationRules?: EscalationRuleDto[];

    @ApiPropertyOptional({ type: IdleReminderDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => IdleReminderDto)
    idleReminder?: IdleReminderDto;

    @ApiPropertyOptional({ example: true })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}