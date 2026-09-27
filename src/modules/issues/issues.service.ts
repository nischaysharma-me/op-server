import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Issue, IssueDocument } from './schemas/issue.schema';
import { Poll, PollDocument } from '../polls/schemas/poll.schema';
import { CreateIssueDto } from './dto/create-issue.dto';
import { UpdateIssueDto } from './dto/update-issue.dto';
import { UpdateOpinionDto } from './dto/update-opinion.dto';
import { VectorService } from '../vector/vector.service';

@Injectable()
export class IssuesService {
  constructor(
    @InjectModel(Issue.name) private readonly issueModel: Model<IssueDocument>,
    @InjectModel(Poll.name) private readonly pollModel: Model<PollDocument>,
    private readonly vectorService: VectorService,
  ) {}

  async findAll(): Promise<{ issues: Issue[] }> {
    try {
      const issues = await this.issueModel.find().exec();
      return { issues };
    } catch (error) {
      throw new NotFoundException([]);
    }
  }

  async findOne(id: string): Promise<{ issue: Issue }> {
    try {
      const issue = await this.issueModel.findById(id).exec();
      return { issue };
    } catch (error) {
      throw new NotFoundException({});
    }
  }

  async findByUser(userId: string): Promise<{ issues: Issue[] }> {
    try {
      const issues = await this.issueModel
        .find({
          $or: [{ creator: userId }, { creator: { $regex: new RegExp(`^${userId}$`, 'i') } }],
        })
        .sort({ createdAt: -1 })
        .exec();
      return { issues };
    } catch (error) {
      throw new NotFoundException([]);
    }
  }

  async create(createIssueDto: CreateIssueDto): Promise<{ issue: Issue }> {
    try {
      if (!createIssueDto.title || !createIssueDto.title.trim()) {
        const cleanContent = (createIssueDto.content || '')
          .replace(/<[^>]*>/g, '')
          .replace(/[#*`_~]/g, '')
          .trim();
        const firstLine = cleanContent.split('\n')[0].trim();
        createIssueDto.title = firstLine.slice(0, 80) || 'Trouble Discussion';
      }
      const issue = new this.issueModel(createIssueDto);
      const data = await issue.save();

      // Index newly created trouble into its dedicated Pinecone vector DB namespace: trouble-{id}
      const troubleText = `${data.title}\n\n${data.content}${
        data.codeSnippet ? `\n\nCode Context:\n${data.codeSnippet}` : ''
      }`;
      this.vectorService
        .indexTroubleContext(
          (data as any)._id.toString(),
          `trouble_root_${(data as any)._id}`,
          troubleText,
          {
            title: data.title,
            tags: data.tags || [],
            creator: data.creator,
            type: 'ROOT_TROUBLE',
          },
        )
        .catch(() => {});

      return { issue: data };
    } catch (error) {
      throw new NotFoundException('Unable to posted Issue, Try Again!');
    }
  }

  async update(id: string, updateIssueDto: UpdateIssueDto): Promise<string> {
    try {
      await this.issueModel.updateOne({ _id: id }, updateIssueDto).exec();
      return 'updated Sucessfully';
    } catch (error) {
      throw new NotFoundException('Unable to Update Issue, Try Again!');
    }
  }

  async updateOpinions(
    id: string,
    updateOpinionDto: UpdateOpinionDto,
  ): Promise<string> {
    const { userId, opinion } = updateOpinionDto;
    try {
      const selectedIssue = await this.issueModel.findById(id).exec();
      if (selectedIssue && selectedIssue.opinions && selectedIssue.opinions.length > 0) {
        const userOpinion = selectedIssue.opinions.filter(
          (each) => each.userId === userId,
        );
        if (userOpinion.length > 0) {
          const updatedOpinions = selectedIssue.opinions.map((each) => {
            if (each.userId === userId) {
              if (each.opinion !== opinion) each.opinion = opinion;
            }
            return each;
          });
          await this.issueModel
            .updateOne({ _id: id }, { opinions: updatedOpinions })
            .exec();
          return 'opinion updated Successfully';
        } else {
          await this.issueModel
            .updateOne(
              { _id: id },
              { $push: { opinions: { userId, opinion } } },
            )
            .exec();
          return 'opinion added successfully';
        }
      } else {
        await this.issueModel
          .updateOne(
            { _id: id },
            { $push: { opinions: { userId, opinion } } },
          )
          .exec();
        return 'opinion added successfully';
      }
    } catch (error) {
      throw new NotFoundException('Unable to Update Issue, Try Again!');
    }
  }

  async remove(id: string): Promise<string> {
    try {
      await this.issueModel.deleteOne({ _id: id }).exec();
      await this.pollModel.deleteOne({ issueId: id }).exec();
      return 'deleted Sucessfully';
    } catch (error) {
      throw new NotFoundException('Unable to Delete, Try Again!');
    }
  }
}
