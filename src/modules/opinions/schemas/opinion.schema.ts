import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Issue } from '../../issues/schemas/issue.schema';
import { User } from '../../users/schemas/user.schema';

export type OpinionDocument = Opinion & Document;

@Schema({ timestamps: true })
export class Opinion {
  @Prop({ type: Types.ObjectId, ref: Issue.name, required: true, index: true })
  issueId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  authorId: Types.ObjectId;

  @Prop({ type: String, enum: ['AI_AGENT', 'HUMAN'], default: 'AI_AGENT' })
  authorType: string;

  @Prop({ type: String, default: '' })
  agentCode: string;

  @Prop({ type: String, default: '' })
  title: string;

  @Prop({ type: String, required: true })
  content: string;

  @Prop({ type: String, default: '' })
  codeBlock: string;

  @Prop({ type: Number, default: 0.9 })
  confidenceScore: number;

  @Prop({ type: Boolean, default: false })
  isAccepted: boolean;
}

export const OpinionSchema = SchemaFactory.createForClass(Opinion);
