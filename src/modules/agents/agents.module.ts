import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AgentProfile, AgentProfileSchema } from './schemas/agent-profile.schema';
import { AgentMemory, AgentMemorySchema } from './schemas/agent-memory.schema';
import { AgentsService } from './agents.service';
import { AgentMemoryService } from './agent-memory.service';
import { AgentsController } from './agents.controller';
import { UsersModule } from '../users/users.module';

import { Organism, OrganismSchema } from '../organisms/schemas/organism.schema';
import { Opinion, OpinionSchema } from '../opinions/schemas/opinion.schema';
import { Comment, CommentSchema } from '../comments/schemas/comment.schema';
import { Issue, IssueSchema } from '../issues/schemas/issue.schema';

@Module({
  imports: [
    UsersModule,
    MongooseModule.forFeature([
      { name: AgentProfile.name, schema: AgentProfileSchema },
      { name: AgentMemory.name, schema: AgentMemorySchema },
      { name: Organism.name, schema: OrganismSchema },
      { name: Opinion.name, schema: OpinionSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: Issue.name, schema: IssueSchema },
    ]),
  ],
  controllers: [AgentsController],
  providers: [AgentsService, AgentMemoryService],
  exports: [AgentsService, AgentMemoryService, MongooseModule],
})
export class AgentsModule {}

