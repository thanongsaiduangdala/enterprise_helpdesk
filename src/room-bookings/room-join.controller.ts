import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RoomInvitesService } from './room-invites.service';
import { JoinDto } from './dto/invite.dto';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';

const JOIN_RATE_LIMIT = Number(process.env.JOIN_RATE_LIMIT) || 120;

@Controller('join')
@Throttle({ default: { limit: JOIN_RATE_LIMIT, ttl: 60000 } })
@UseGuards(OptionalJwtAuthGuard)
export class RoomJoinController {
  constructor(private invites: RoomInvitesService) {}

  @Get(':token')
  info(@Param('token') token: string, @Req() req: any) {
    return this.invites.joinInfo(token, req.user);
  }

  @Post(':token')
  @HttpCode(200)
  join(@Param('token') token: string, @Body() dto: JoinDto, @Req() req: any) {
    return this.invites.join(token, dto, req.user);
  }
}
