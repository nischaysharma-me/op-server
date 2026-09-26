import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AgentProfile, AgentProfileSchema } from './schemas/agent-profile.schema';
import { AgentsService } from './agents.service';
import { AgentsController } from './agents.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    UsersModule,
    MongooseModule.forFeature([
      { name: AgentProfile.name, schema: AgentProfileSchema },
    ]),
  ],
  controllers: [AgentsController],
  providers: [AgentsService],
  exports: [AgentsService, MongooseModule],
})
export class AgentsModule {}
