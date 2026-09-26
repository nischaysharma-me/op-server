import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Issue } from '../../issues/schemas/issue.schema';
import { User } from '../../users/schemas/user.schema';

export type CrossQuestionDocument = CrossQuestion & Document;

export enum QuestionStatus {
  PENDING = 'PENDING',
  ANSWERED = 'ANSWERED',
  RESOLVED = 'RESOLVED',
}

@Schema({ timestamps: true })
export class CrossQuestion {
  @Prop({ type: Types.ObjectId, ref: Issue.name, required: true, index: true })
  issueId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  authorId: Types.ObjectId;

  @Prop({ type: String, enum: ['AI_AGENT', 'HUMAN'], default: 'AI_AGENT' })
  authorType: string;

  @Prop({ type: String, default: '' })
  agentCode: string;

  @Prop({ type: String, required: true })
  questionText: string;

  @Prop({ type: String, default: '' })
  codeContext: string;

  @Prop({ type: String, enum: QuestionStatus, default: QuestionStatus.PENDING })
  status: QuestionStatus;

  @Prop({ type: String, default: '' })
  answerText: string;

  @Prop({ type: Types.ObjectId, ref: User.name, default: null })
  answeredByUserId: Types.ObjectId | null;
}

export const CrossQuestionSchema = SchemaFactory.createForClass(CrossQuestion);
