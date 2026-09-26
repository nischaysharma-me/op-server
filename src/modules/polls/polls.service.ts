import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Poll, PollDocument } from './schemas/poll.schema';
import { UpdatePollDto } from './dto/update-poll.dto';

@Injectable()
export class PollsService {
  constructor(
    @InjectModel(Poll.name) private readonly pollModel: Model<PollDocument>,
  ) {}

  async findAll(): Promise<{ polls: Poll[] }> {
    try {
      const polls = await this.pollModel.find().exec();
      return { polls };
    } catch (error) {
      throw new BadRequestException([]);
    }
  }

  async findOneByIssueId(id: string): Promise<{ polls: Poll | null }> {
    try {
      const polls = await this.pollModel.findOne({ issueId: id }).exec();
      return { polls };
    } catch (error) {
      throw new BadRequestException([]);
    }
  }

  async findCategory(option: string): Promise<any> {
    try {
      const polls = await this.pollModel.find().exec();
      switch (option) {
        case 'likes': {
          const totalLikes = polls.filter((each) => each.opinion === 'like');
          return { likes: totalLikes.length };
        }
        case 'dislikes': {
          const totalDislikes = polls.filter((each) => each.opinion === 'dislike');
          return { dislikes: totalDislikes.length };
        }
        default:
          return { allPolls: polls.length };
      }
    } catch (error) {
      throw new BadRequestException('no available polls');
    }
  }

  async update(id: string, updatePollDto: UpdatePollDto): Promise<string> {
    const { opinion, userId } = updatePollDto;
    try {
      const issuePolls = await this.pollModel.findById(id).exec();
      if (!issuePolls) {
        throw new BadRequestException('Poll not found');
      }

      if (issuePolls.opinions && issuePolls.opinions.length > 0) {
        const userOpinion = issuePolls.opinions.filter(
          (each) => each.userId === userId,
        );
        if (userOpinion.length > 0) {
          const userResponse = userOpinion[0].opinion;
          if (userResponse === opinion) {
            return 'Nothing to change';
          } else {
            const updatedOpinions = issuePolls.opinions.map((each) => {
              if (each.userId === userId) each.opinion = opinion;
              return each;
            });
            await this.pollModel
              .updateOne({ _id: id }, { opinions: updatedOpinions })
              .exec();
            return 'Opinion Added Successfully';
          }
        } else {
          await this.pollModel
            .updateOne({ _id: id }, { $push: { opinions: { userId, opinion } } })
            .exec();
          return 'Opinion Added Successfully';
        }
      } else {
        await this.pollModel
          .updateOne({ _id: id }, { $push: { opinions: { userId, opinion } } })
          .exec();
        return 'Opinion Added Successfully';
      }
    } catch (error) {
      throw new BadRequestException('Unable to add Opinion, Try Again!');
    }
  }
}
