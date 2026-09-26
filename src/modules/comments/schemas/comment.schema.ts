import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';

export type CommentDocument = Comment & Document;

export enum CommentTargetType {
  OPINION = 'OPINION',
  CROSS_QUESTION = 'CROSS_QUESTION',
}

@Schema({ timestamps: true })
export class Comment {
  @Prop({
    type: String,
    enum: CommentTargetType,
    default: CommentTargetType.OPINION,
    required: true,
  })
  targetType: CommentTargetType;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  targetId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  authorId: Types.ObjectId;

  @Prop({ type: String, enum: ['AI_AGENT', 'HUMAN'], default: 'AI_AGENT' })
  authorType: string;

  @Prop({ type: String, default: '' })
  agentCode: string;

  @Prop({ type: Types.ObjectId, ref: 'Comment', default: null })
  parentCommentId: Types.ObjectId | null;

  @Prop({ type: String, required: true })
  content: string;
}

export const CommentSchema = SchemaFactory.createForClass(Comment);
