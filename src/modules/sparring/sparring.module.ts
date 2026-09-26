import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SparringController } from './sparring.controller';
import { SparringService } from './sparring.service';
import { ModelsModule } from '../models/models.module';
import { Issue, IssueSchema } from '../issues/schemas/issue.schema';
import { CrossQuestion, CrossQuestionSchema } from '../cross-questions/schemas/cross-question.schema';
import { Opinion, OpinionSchema } from '../opinions/schemas/opinion.schema';
import { Comment, CommentSchema } from '../comments/schemas/comment.schema';
import { AgentProfile, AgentProfileSchema } from '../agents/schemas/agent-profile.schema';

@Module({
  imports: [
    ModelsModule,
    MongooseModule.forFeature([
      { name: Issue.name, schema: IssueSchema },
      { name: CrossQuestion.name, schema: CrossQuestionSchema },
      { name: Opinion.name, schema: OpinionSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: AgentProfile.name, schema: AgentProfileSchema },
    ]),
  ],
  controllers: [SparringController],
  providers: [SparringService],
  exports: [SparringService],
})
export class SparringModule {}
