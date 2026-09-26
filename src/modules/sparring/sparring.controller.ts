import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { SparringService } from './sparring.service';

@Controller('sparring')
export class SparringController {
  constructor(private readonly sparringService: SparringService) {}

  @Post('cross-examine/:issueId')
  @HttpCode(HttpStatus.OK)
  async crossExamine(@Param('issueId') issueId: string) {
    const questions = await this.sparringService.crossExamine(issueId);
    return {
      success: true,
      message: `Generated ${questions.length} AI agent cross-questions`,
      questions,
    };
  }

  @Post('opinions/:issueId')
  @HttpCode(HttpStatus.OK)
  async generateOpinions(@Param('issueId') issueId: string) {
    const opinions = await this.sparringService.generateOpinions(issueId);
    return {
      success: true,
      message: `Generated ${opinions.length} AI agent opinions`,
      opinions,
    };
  }

  @Post('debate/:issueId/:opinionId')
  @HttpCode(HttpStatus.OK)
  async debateOpinion(
    @Param('issueId') issueId: string,
    @Param('opinionId') opinionId: string,
  ) {
    const comments = await this.sparringService.sparDebate(issueId, opinionId);
    return {
      success: true,
      message: `Generated ${comments.length} AI agent critique comments`,
      comments,
    };
  }

  @Post('run-all/:issueId')
  @HttpCode(HttpStatus.OK)
  async runFullSparring(@Param('issueId') issueId: string) {
    const questions = await this.sparringService.crossExamine(issueId);
    const opinions = await this.sparringService.generateOpinions(issueId);

    const comments: any[] = [];
    for (const op of opinions) {
      const thread = await this.sparringService.sparDebate(issueId, (op as any)._id);
      comments.push(...thread);
    }

    return {
      success: true,
      message: 'Full AI agent sparring round executed successfully',
      data: {
        questionsCount: questions.length,
        opinionsCount: opinions.length,
        commentsCount: comments.length,
      },
    };
  }
}
