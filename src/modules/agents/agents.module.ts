import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AgentProfile, AgentProfileSchema } from './schemas/agent-profile.schema';
import { AgentMemory, AgentMemorySchema } from './schemas/agent-memory.schema';
import { AgentsService } from './agents.service';
import { AgentMemoryService } from './agent-memory.service';
import { AgentsController } from './agents.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    UsersModule,
    MongooseModule.forFeature([
      { name: AgentProfile.name, schema: AgentProfileSchema },
      { name: AgentMemory.name, schema: AgentMemorySchema },
    ]),
  ],
  controllers: [AgentsController],
  providers: [AgentsService, AgentMemoryService],
  exports: [AgentsService, AgentMemoryService, MongooseModule],
})
export class AgentsModule {}

