import { Controller, HttpCode, HttpStatus, Param, Post, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { SparringService, SparringStreamEvent } from './sparring.service';

@Controller('sparring')
export class SparringController {
  constructor(private readonly sparringService: SparringService) {}

  /**
   * Real-time Server-Sent Events (SSE) token streaming for full multi-agent sparring cycle
   */
  @Get('stream/:issueId')
  async streamGet(
    @Param('issueId') issueId: string,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (typeof (res as any).flushHeaders === 'function') {
      (res as any).flushHeaders();
    }

    const emit = (event: SparringStreamEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (typeof (res as any).flush === 'function') {
        (res as any).flush();
      }
    };

    try {
      await this.sparringService.streamFullSparring(issueId, emit);
    } catch (err: any) {
      emit({ type: 'error', text: err.message });
    } finally {
      res.end();
    }
  }

  @Post('stream/:issueId')
  async streamPost(
    @Param('issueId') issueId: string,
    @Res() res: Response,
  ) {
    return this.streamGet(issueId, res);
  }

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
