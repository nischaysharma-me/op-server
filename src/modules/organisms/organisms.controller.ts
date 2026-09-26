import { Controller, Get, Post, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { EvolutionService } from './evolution.service';

@Controller('organisms')
export class OrganismsController {
  constructor(private readonly evolutionService: EvolutionService) {}

  @Get()
  getOrganisms(
    @Query('activeOnly') activeOnly?: string,
    @Query('stage') stage?: string,
    @Query('generation') generation?: string,
  ) {
    return this.evolutionService.getOrganisms({
      activeOnly: activeOnly === 'true',
      stage,
      generation: generation ? parseInt(generation, 10) : undefined,
    });
  }

  @Get('stats')
  getEcosystemStats() {
    return this.evolutionService.getEcosystemStats();
  }

  @Get('timeline/events')
  getTimeline(@Query('limit') limit?: string) {
    return this.evolutionService.getTimeline(limit ? parseInt(limit, 10) : 40);
  }

  @Get(':code')
  getOrganismByCode(@Param('code') code: string) {
    return this.evolutionService.getOrganismByCode(code);
  }

  @Post('evolve/tick')
  @HttpCode(HttpStatus.OK)
  triggerSimulationTick() {
    return this.evolutionService.tickSimulation();
  }
}
