import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { IssuesController } from './issues.controller';
import { IssuesService } from './issues.service';
import { Issue, IssueSchema } from './schemas/issue.schema';
import { Poll, PollSchema } from '../polls/schemas/poll.schema';
import { SparringModule } from '../sparring/sparring.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Issue.name, schema: IssueSchema },
      { name: Poll.name, schema: PollSchema },
    ]),
    forwardRef(() => SparringModule),
  ],
  controllers: [IssuesController],
  providers: [IssuesService],
  exports: [IssuesService],
})
export class IssuesModule {}
