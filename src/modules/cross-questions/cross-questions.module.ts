import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  CrossQuestion,
  CrossQuestionSchema,
} from './schemas/cross-question.schema';
import { CrossQuestionsService } from './cross-questions.service';
import { CrossQuestionsController } from './cross-questions.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CrossQuestion.name, schema: CrossQuestionSchema },
    ]),
  ],
  controllers: [CrossQuestionsController],
  providers: [CrossQuestionsService],
  exports: [CrossQuestionsService, MongooseModule],
})
export class CrossQuestionsModule {}
