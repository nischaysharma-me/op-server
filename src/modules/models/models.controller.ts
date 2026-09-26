import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ModelsService } from './models.service';
import { UpdateSparringConfigDto } from './dto/update-sparring-config.dto';

@Controller('models')
export class ModelsController {
  constructor(private readonly modelsService: ModelsService) {}

  @Get()
  async getModels(@Query('refresh') refresh?: string) {
    const forceRefresh = refresh === 'true' || refresh === '1';
    const models = await this.modelsService.fetchOpenRouterModels(forceRefresh);
    const stats = await this.modelsService.getModelStats();
    return {
      success: true,
      stats,
      models,
    };
  }

  @Get('stats')
  async getStats() {
    return this.modelsService.getModelStats();
  }

  @Get('sparring-config')
  async getSparringConfig() {
    return this.modelsService.getSparringConfig();
  }

  @Post('sparring-config')
  @HttpCode(HttpStatus.OK)
  async updateSparringConfig(@Body() dto: UpdateSparringConfigDto) {
    const updated = await this.modelsService.updateSparringConfig(dto);
    return {
      success: true,
      message: 'Sparring model configuration updated successfully',
      config: updated,
    };
  }
}
