import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class KbArticleFeedbackDto {
    @ApiProperty({ example: true, description: 'true = helpful (👍), false = not helpful (👎)' })
    @IsBoolean()
    helpful!: boolean;
}
