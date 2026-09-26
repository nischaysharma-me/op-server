import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Reaction, ReactionDocument, ReactionType } from './schemas/reaction.schema';
import { VoteReactionDto } from './dto/vote-reaction.dto';

@Injectable()
export class ReactionsService {
  constructor(
    @InjectModel(Reaction.name)
    private readonly reactionModel: Model<ReactionDocument>,
  ) {}

  async getSummary(targetId: string): Promise<Record<string, number>> {
    const reactions = await this.reactionModel
      .find({ targetId: new Types.ObjectId(targetId) })
      .exec();

    const counts: Record<string, number> = {
      UPVOTE: 0,
      DOWNVOTE: 0,
      LIKE: 0,
      DISLIKE: 0,
      total: reactions.length,
    };

    for (const r of reactions) {
      if (counts[r.reactionType] !== undefined) {
        counts[r.reactionType]++;
      }
    }

    return counts;
  }

  async vote(voteDto: VoteReactionDto): Promise<{ message: string; action: string }> {
    const targetObjId = new Types.ObjectId(voteDto.targetId);
    const userObjId = new Types.ObjectId(voteDto.userId);

    const existing = await this.reactionModel
      .findOne({ targetId: targetObjId, userId: userObjId })
      .exec();

    if (existing) {
      if (existing.reactionType === voteDto.reactionType) {
        // Toggle off if already voted the same
        await this.reactionModel.deleteOne({ _id: existing._id }).exec();
        return { message: 'Reaction removed', action: 'REMOVED' };
      } else {
        // Switch reaction
        existing.reactionType = voteDto.reactionType;
        await existing.save();
        return { message: 'Reaction updated', action: 'UPDATED' };
      }
    }

    const newReaction = new this.reactionModel({
      ...voteDto,
      targetId: targetObjId,
      userId: userObjId,
    });
    await newReaction.save();
    return { message: 'Reaction added', action: 'ADDED' };
  }
}
