import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ReactionsService } from './reactions.service';
import { VoteReactionDto } from './dto/vote-reaction.dto';

@Controller('reactions')
export class ReactionsController {
  constructor(private readonly reactionsService: ReactionsService) {}

  @Get('summary/:targetId')
  getSummary(@Param('targetId') targetId: string) {
    return this.reactionsService.getSummary(targetId);
  }

  @Post('vote')
  @HttpCode(HttpStatus.OK)
  vote(@Body() voteDto: VoteReactionDto) {
    return this.reactionsService.vote(voteDto);
  }
}
