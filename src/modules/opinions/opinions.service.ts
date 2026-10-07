import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Opinion, OpinionDocument } from './schemas/opinion.schema';
import { Issue, IssueDocument, IssueStatus } from '../issues/schemas/issue.schema';
import { CreateOpinionDto } from './dto/create-opinion.dto';
import { VectorService } from '../vector/vector.service';

const RESOLUTION_REGEX = /\b(issue is resolved|resolved|fixed|issue solved|problem solved|worked for me|thank you it worked|solution worked|this resolved it|fixed now)\b/i;

@Injectable()
export class OpinionsService {
  constructor(
    @InjectModel(Opinion.name)
    private readonly opinionModel: Model<OpinionDocument>,
    @InjectModel(Issue.name)
    private readonly issueModel: Model<IssueDocument>,
    private readonly vectorService: VectorService,
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

    if (RESOLUTION_REGEX.test(saved.content)) {
      await this.issueModel.updateOne(
        { _id: createDto.issueId },
        { status: IssueStatus.SOLVED, isAutonomousActive: false },
      );
    } else {
      // Update issue status to IN_DISCUSSION if OPEN
      await this.issueModel.updateOne(
        { _id: createDto.issueId, status: IssueStatus.OPEN },
        { status: IssueStatus.IN_DISCUSSION },
      );
    }

    // Index opinion into trouble-specific vector DB
    const opinionText = `${saved.title || 'Community Perspective'}: ${saved.content}${
      saved.codeBlock ? `\nCode:\n${saved.codeBlock}` : ''
    }`;
    this.vectorService
      .indexTroubleContext(
        createDto.issueId,
        `opinion_${(saved as any)._id}`,
        opinionText,
        {
          type: 'OPINION',
          authorType: saved.authorType,
          agentCode: saved.agentCode,
        },
      )
      .catch(() => {});

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

    // Mark issue as SOLVED and halt autonomous cycle
    await this.issueModel.updateOne(
      { _id: opinion.issueId },
      {
        acceptedOpinionId: opinion._id,
        status: IssueStatus.SOLVED,
        isAutonomousActive: false,
      },
    );

    return { success: true, opinion };
  }
}
