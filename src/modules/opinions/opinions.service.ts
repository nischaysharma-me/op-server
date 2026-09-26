import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Opinion, OpinionDocument } from './schemas/opinion.schema';
import { Issue, IssueDocument, IssueStatus } from '../issues/schemas/issue.schema';
import { CreateOpinionDto } from './dto/create-opinion.dto';

@Injectable()
export class OpinionsService {
  constructor(
    @InjectModel(Opinion.name)
    private readonly opinionModel: Model<OpinionDocument>,
    @InjectModel(Issue.name)
    private readonly issueModel: Model<IssueDocument>,
  ) {}

  async findByIssue(issueId: string): Promise<Opinion[]> {
    return this.opinionModel
      .find({ issueId: new Types.ObjectId(issueId) })
      .populate('authorId', 'username firstName lastName isAi avatarUrl reputation')
      .sort({ isAccepted: -1, createdAt: -1 })
      .exec();
  }

  async findOne(id: string): Promise<Opinion> {
    const opinion = await this.opinionModel
      .findById(id)
      .populate('authorId', 'username firstName lastName isAi avatarUrl reputation')
      .exec();
    if (!opinion) {
      throw new NotFoundException('Opinion not found');
    }
    return opinion;
  }

  async create(createDto: CreateOpinionDto): Promise<Opinion> {
    const opinion = new this.opinionModel({
      ...createDto,
      issueId: new Types.ObjectId(createDto.issueId),
      authorId: new Types.ObjectId(createDto.authorId),
    });
    const saved = await opinion.save();
    // Update issue status to IN_DISCUSSION if OPEN
    await this.issueModel.updateOne(
      { _id: createDto.issueId, status: IssueStatus.OPEN },
      { status: IssueStatus.IN_DISCUSSION },
    );
    return saved;
  }

  async acceptSolution(opinionId: string): Promise<{ success: boolean; opinion: Opinion }> {
    const opinion = await this.opinionModel.findById(opinionId).exec();
    if (!opinion) {
      throw new NotFoundException('Opinion not found');
    }

    // Reset any other accepted opinions on this issue
    await this.opinionModel.updateMany(
      { issueId: opinion.issueId },
      { isAccepted: false },
    );

    opinion.isAccepted = true;
    await opinion.save();

    // Mark issue as SOLVED
    await this.issueModel.updateOne(
      { _id: opinion.issueId },
      {
        acceptedOpinionId: opinion._id,
        status: IssueStatus.SOLVED,
      },
    );

    return { success: true, opinion };
  }
}
