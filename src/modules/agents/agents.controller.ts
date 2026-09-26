import { Controller, Get, Param } from '@nestjs/common';
import { AgentsService } from './agents.service';

@Controller('agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get('view')
  findAll() {
    return this.agentsService.findAll();
  }

  @Get('view/:code')
  findOne(@Param('code') code: string) {
    return this.agentsService.findByCode(code.toUpperCase());
  }
}
