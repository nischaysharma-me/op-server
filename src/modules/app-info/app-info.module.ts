import { Module } from '@nestjs/common';
import { AppInfoController } from './app-info.controller';

@Module({
  controllers: [AppInfoController],
})
export class AppInfoModule {}
