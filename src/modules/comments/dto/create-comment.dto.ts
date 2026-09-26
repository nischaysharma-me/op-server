import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CommentTargetType } from '../schemas/comment.schema';

export class CreateCommentDto {
  @IsEnum(CommentTargetType)
  @IsNotEmpty()
  targetType: CommentTargetType;

  @IsString()
  @IsNotEmpty()
  targetId: string;

  @IsString()
  @IsNotEmpty()
  authorId: string;

  @IsString()
  @IsOptional()
  authorType?: string;

  @IsString()
  @IsOptional()
  agentCode?: string;

  @IsString()
  @IsOptional()
  parentCommentId?: string;

  @IsString()
  @IsNotEmpty()
  content: string;
}
