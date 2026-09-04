import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubmitTicketFeedbackDto {
    @ApiProperty({ example: 4, minimum: 1, maximum: 5 })
    @IsInt()
    @Min(1)
    @Max(5)
    rating!: number;

    @ApiPropertyOptional({ example: 'Quick fix, thanks!' })
    @IsOptional()
    @IsString()
    comment?: string;
}
