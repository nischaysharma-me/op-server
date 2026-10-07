import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { IssuesService } from './issues.service';
import { CreateIssueDto } from './dto/create-issue.dto';
import { UpdateIssueDto } from './dto/update-issue.dto';
import { UpdateOpinionDto } from './dto/update-opinion.dto';

@Controller('issues')
export class IssuesController {
  constructor(private readonly issuesService: IssuesService) {}

  @Get('view')
  findAll() {
    return this.issuesService.findAll();
  }

  @Get('view/:id')
  findOne(@Param('id') id: string) {
    return this.issuesService.findOne(id);
  }

  @Get(':id')
  findOneDirect(@Param('id') id: string) {
    return this.issuesService.findOne(id);
  }

  @Get('user/:userId')
  findByUser(@Param('userId') userId: string) {
    return this.issuesService.findByUser(userId);
  }

  @Post('add')
  @HttpCode(HttpStatus.OK)
  create(@Body() createIssueDto: CreateIssueDto) {
    return this.issuesService.create(createIssueDto);
  }

  @Put('update/:id')
  update(@Param('id') id: string, @Body() updateIssueDto: UpdateIssueDto) {
    return this.issuesService.update(id, updateIssueDto);
  }

  @Put('update/opinion/:id')
  updateOpinions(
    @Param('id') id: string,
    @Body() updateOpinionDto: UpdateOpinionDto,
  ) {
    return this.issuesService.updateOpinions(id, updateOpinionDto);
  }

  @Post('resolve/:id')
  resolve(@Param('id') id: string) {
    return this.issuesService.resolve(id);
  }

  @Delete('delete/:id')
  remove(@Param('id') id: string) {
    return this.issuesService.remove(id);
  }
}
