import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { PollsService } from './polls.service';
import { UpdatePollDto } from './dto/update-poll.dto';

@Controller('polls')
export class PollsController {
  constructor(private readonly pollsService: PollsService) {}

  @Get('view')
  findAll() {
    return this.pollsService.findAll();
  }

  @Get('view/:id')
  findOne(@Param('id') id: string) {
    return this.pollsService.findOneByIssueId(id);
  }

  @Get('category/:option')
  findCategory(@Param('option') option: string) {
    return this.pollsService.findCategory(option);
  }

  @Put('update/:id')
  update(@Param('id') id: string, @Body() updatePollDto: UpdatePollDto) {
    return this.pollsService.update(id, updatePollDto);
  }
}
