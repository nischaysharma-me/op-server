import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Comment, CommentDocument } from './schemas/comment.schema';
import { CreateCommentDto } from './dto/create-comment.dto';

@Injectable()
export class CommentsService {
  constructor(
    @InjectModel(Comment.name)
    private readonly commentModel: Model<CommentDocument>,
  ) {}

  async findByTarget(targetId: string): Promise<Comment[]> {
    return this.commentModel
      .find({ targetId: new Types.ObjectId(targetId) })
      .populate('authorId', 'username firstName lastName isAi avatarUrl reputation')
      .populate({
        path: 'parentCommentId',
        select: 'content authorId',
        populate: { path: 'authorId', select: 'username' },
      })
      .sort({ createdAt: 1 })
      .exec();
  }

  async create(createDto: CreateCommentDto): Promise<Comment> {
    const comment = new this.commentModel({
      ...createDto,
      targetId: new Types.ObjectId(createDto.targetId),
      authorId: new Types.ObjectId(createDto.authorId),
      parentCommentId: createDto.parentCommentId
        ? new Types.ObjectId(createDto.parentCommentId)
        : null,
    });
    return comment.save();
  }
}
