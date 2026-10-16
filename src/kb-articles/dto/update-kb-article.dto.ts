import { PartialType } from '@nestjs/swagger';
import { CreateKbArticleDto } from './create-kb-article.dto';

export class UpdateKbArticleDto extends PartialType(CreateKbArticleDto) {}
