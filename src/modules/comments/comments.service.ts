import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Comment, CommentDocument } from './schemas/comment.schema';
import { CreateCommentDto } from './dto/create-comment.dto';

import { Opinion, OpinionDocument } from '../opinions/schemas/opinion.schema';
import { Issue, IssueDocument, IssueStatus } from '../issues/schemas/issue.schema';
import { VectorService } from '../vector/vector.service';

const RESOLUTION_REGEX = /\b(issue is resolved|resolved|fixed|issue solved|problem solved|worked for me|thank you it worked|solution worked|this resolved it|fixed now)\b/i;

@Injectable()
export class CommentsService {
  constructor(
    @InjectModel(Comment.name)
    private readonly commentModel: Model<CommentDocument>,
    @InjectModel(Opinion.name)
    private readonly opinionModel: Model<OpinionDocument>,
    @InjectModel(Issue.name)
    private readonly issueModel: Model<IssueDocument>,
    private readonly vectorService: VectorService,
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
    const saved = await comment.save();

    // Resolve troubleId for vector indexing
    let troubleId = createDto.targetId;
    if (createDto.targetType === 'OPINION') {
      try {
        const op = await this.opinionModel.findById(createDto.targetId).exec();
        if (op && (op as any).issueId) {
          troubleId = (op as any).issueId.toString();
        }
      } catch {}
    }

    if (troubleId) {
      this.vectorService
        .indexTroubleContext(
          troubleId,
          `comment_${(saved as any)._id}`,
          `Thread Reply: ${saved.content}`,
          {
            type: 'COMMENT',
            targetType: saved.targetType,
            authorType: saved.authorType,
          },
        )
        .catch(() => {});

      // Auto-resolution check: If comment states the trouble is resolved, halt autonomous cycle
      if (RESOLUTION_REGEX.test(saved.content)) {
        this.issueModel
          .findByIdAndUpdate(troubleId, {
            status: IssueStatus.SOLVED,
            isAutonomousActive: false,
          })
          .exec()
          .catch(() => {});
      }
    }

    const populated = await this.commentModel
      .findById(saved._id)
      .populate('authorId', 'username firstName lastName isAi avatarUrl reputation')
      .populate({
        path: 'parentCommentId',
        select: 'content authorId',
        populate: { path: 'authorId', select: 'username firstName' },
      })
      .exec();
    return populated || saved;
  }
}
