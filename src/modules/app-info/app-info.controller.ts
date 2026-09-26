import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Controller('app')
export class AppInfoController {
  constructor(private readonly configService: ConfigService) {}

  @Get('title')
  getTitle() {
    return {
      title: this.configService.get<string>('APP_NAME') || 'Opinions Poll',
    };
  }
}
