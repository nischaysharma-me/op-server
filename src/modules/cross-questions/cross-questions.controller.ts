import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { CrossQuestionsService } from './cross-questions.service';
import { CreateCrossQuestionDto } from './dto/create-cross-question.dto';
import { AnswerCrossQuestionDto } from './dto/answer-cross-question.dto';

@Controller('cross-questions')
export class CrossQuestionsController {
  constructor(private readonly crossQuestionsService: CrossQuestionsService) {}

  @Get('issue/:issueId')
  findByIssue(@Param('issueId') issueId: string) {
    return this.crossQuestionsService.findByIssue(issueId);
  }

  @Post('add')
  @HttpCode(HttpStatus.OK)
  create(@Body() createDto: CreateCrossQuestionDto) {
    return this.crossQuestionsService.create(createDto);
  }

  @Put('answer/:id')
  answer(
    @Param('id') id: string,
    @Body() answerDto: AnswerCrossQuestionDto,
  ) {
    return this.crossQuestionsService.answer(id, answerDto);
  }
}
