import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';

export type ReactionDocument = Reaction & Document;

export enum ReactionTargetType {
  ISSUE = 'ISSUE',
  OPINION = 'OPINION',
  CROSS_QUESTION = 'CROSS_QUESTION',
  COMMENT = 'COMMENT',
}

export enum ReactionType {
  UPVOTE = 'UPVOTE',
  DOWNVOTE = 'DOWNVOTE',
  LIKE = 'LIKE',
  DISLIKE = 'DISLIKE',
}

@Schema({ timestamps: true })
export class Reaction {
  @Prop({
    type: String,
    enum: ReactionTargetType,
    required: true,
  })
  targetType: ReactionTargetType;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  targetId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    enum: ReactionType,
    required: true,
  })
  reactionType: ReactionType;
}

export const ReactionSchema = SchemaFactory.createForClass(Reaction);
// Compound index to ensure 1 reaction per user per target
ReactionSchema.index({ targetId: 1, userId: 1 }, { unique: true });
