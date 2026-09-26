import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Opinion, OpinionSchema } from './schemas/opinion.schema';
import { Issue, IssueSchema } from '../issues/schemas/issue.schema';
import { OpinionsService } from './opinions.service';
import { OpinionsController } from './opinions.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Opinion.name, schema: OpinionSchema },
      { name: Issue.name, schema: IssueSchema },
    ]),
  ],
  controllers: [OpinionsController],
  providers: [OpinionsService],
  exports: [OpinionsService, MongooseModule],
})
export class OpinionsModule {}
