import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ModelsController } from './models.controller';
import { ModelsService } from './models.service';
import { SparringConfig, SparringConfigSchema } from './schemas/sparring-config.schema';
import { AgentProfile, AgentProfileSchema } from '../agents/schemas/agent-profile.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SparringConfig.name, schema: SparringConfigSchema },
      { name: AgentProfile.name, schema: AgentProfileSchema },
    ]),
  ],
  controllers: [ModelsController],
  providers: [ModelsService],
  exports: [ModelsService],
})
export class ModelsModule {}
