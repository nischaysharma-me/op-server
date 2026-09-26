import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { ReactionTargetType, ReactionType } from '../schemas/reaction.schema';

export class VoteReactionDto {
  @IsEnum(ReactionTargetType)
  @IsNotEmpty()
  targetType: ReactionTargetType;

  @IsString()
  @IsNotEmpty()
  targetId: string;

  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsEnum(ReactionType)
  @IsNotEmpty()
  reactionType: ReactionType;
}
