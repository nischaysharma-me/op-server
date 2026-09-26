import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';

@Controller('comments')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Get('target/:targetId')
  findByTarget(@Param('targetId') targetId: string) {
    return this.commentsService.findByTarget(targetId);
  }

  @Post('add')
  @HttpCode(HttpStatus.OK)
  create(@Body() createDto: CreateCommentDto) {
    return this.commentsService.create(createDto);
  }
}
