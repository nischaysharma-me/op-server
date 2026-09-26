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
import { OpinionsService } from './opinions.service';
import { CreateOpinionDto } from './dto/create-opinion.dto';

@Controller('opinions')
export class OpinionsController {
  constructor(private readonly opinionsService: OpinionsService) {}

  @Get('issue/:issueId')
  findByIssue(@Param('issueId') issueId: string) {
    return this.opinionsService.findByIssue(issueId);
  }

  @Get('view/:id')
  findOne(@Param('id') id: string) {
    return this.opinionsService.findOne(id);
  }

  @Post('add')
  @HttpCode(HttpStatus.OK)
  create(@Body() createDto: CreateOpinionDto) {
    return this.opinionsService.create(createDto);
  }

  @Put('accept/:id')
  acceptSolution(@Param('id') id: string) {
    return this.opinionsService.acceptSolution(id);
  }
}
