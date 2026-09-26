import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CrossQuestion,
  CrossQuestionDocument,
  QuestionStatus,
} from './schemas/cross-question.schema';
import { CreateCrossQuestionDto } from './dto/create-cross-question.dto';
import { AnswerCrossQuestionDto } from './dto/answer-cross-question.dto';

@Injectable()
export class CrossQuestionsService {
  constructor(
    @InjectModel(CrossQuestion.name)
    private readonly crossQuestionModel: Model<CrossQuestionDocument>,
  ) {}

  async findByIssue(issueId: string): Promise<CrossQuestion[]> {
    return this.crossQuestionModel
      .find({ issueId: new Types.ObjectId(issueId) })
      .populate('authorId', 'username firstName lastName isAi avatarUrl')
      .populate('answeredByUserId', 'username firstName lastName avatarUrl')
      .sort({ createdAt: 1 })
      .exec();
  }

  async create(createDto: CreateCrossQuestionDto): Promise<CrossQuestion> {
    const question = new this.crossQuestionModel({
      ...createDto,
      issueId: new Types.ObjectId(createDto.issueId),
      authorId: new Types.ObjectId(createDto.authorId),
    });
    return question.save();
  }

  async answer(id: string, answerDto: AnswerCrossQuestionDto): Promise<CrossQuestion> {
    const question = await this.crossQuestionModel.findById(id).exec();
    if (!question) {
      throw new NotFoundException('Cross question not found');
    }
    question.answerText = answerDto.answerText;
    question.answeredByUserId = new Types.ObjectId(answerDto.userId);
    question.status = QuestionStatus.ANSWERED;
    return question.save();
  }
}
