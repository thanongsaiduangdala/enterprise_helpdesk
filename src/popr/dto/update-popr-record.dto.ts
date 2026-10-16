import { PartialType } from '@nestjs/swagger';
import { CreatePoprRecordDto } from './create-popr-record.dto';

export class UpdatePoprRecordDto extends PartialType(CreatePoprRecordDto) {}
