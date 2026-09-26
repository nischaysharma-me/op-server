import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { Issue, IssueDocument, IssueStatus } from '../issues/schemas/issue.schema';
import { CrossQuestion, CrossQuestionDocument, QuestionStatus } from '../cross-questions/schemas/cross-question.schema';
import { Opinion, OpinionDocument } from '../opinions/schemas/opinion.schema';
import { Comment, CommentDocument, CommentTargetType } from '../comments/schemas/comment.schema';
import { AgentProfile, AgentProfileDocument } from '../agents/schemas/agent-profile.schema';
import { ModelsService } from '../models/models.service';

@Injectable()
export class SparringService {
  private readonly logger = new Logger(SparringService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly modelsService: ModelsService,
    @InjectModel(Issue.name)
    private readonly issueModel: Model<IssueDocument>,
    @InjectModel(CrossQuestion.name)
    private readonly cqModel: Model<CrossQuestionDocument>,
    @InjectModel(Opinion.name)
    private readonly opinionModel: Model<OpinionDocument>,
    @InjectModel(Comment.name)
    private readonly commentModel: Model<CommentDocument>,
    @InjectModel(AgentProfile.name)
    private readonly agentModel: Model<AgentProfileDocument>,
  ) {}

  private getApiKey(): string {
    return (
      this.configService.get<string>('OPEN_ROUTER_API') ||
      this.configService.get<string>('OPENROUTER_API_KEY') ||
      process.env.OPEN_ROUTER_API ||
      process.env.OPENROUTER_API_KEY ||
      ''
    );
  }

  private createChatModel(modelName: string, temperature = 0.7): ChatOpenAI | null {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      this.logger.warn('OpenRouter API key not configured. Fallback generator will be used.');
      return null;
    }

    try {
      return new ChatOpenAI({
        model: modelName,
        apiKey: apiKey,
        configuration: {
          baseURL: 'https://openrouter.ai/api/v1',
          defaultHeaders: {
            'HTTP-Referer': 'http://localhost:4000',
            'X-Title': 'Opinions Poll Multi-Agent Sparring',
          },
        },
        temperature,
        maxTokens: 1000,
      });
    } catch (err: any) {
      this.logger.error(`Error initializing ChatOpenAI with model ${modelName}: ${err.message}`);
      return null;
    }
  }

  /**
   * Phase 1: AI Agents Cross-Examine the Developer Trouble
   */
  async crossExamine(issueId: string): Promise<CrossQuestion[]> {
    const issue = await this.issueModel.findById(issueId).exec();
    if (!issue) {
      throw new NotFoundException(`Issue ${issueId} not found`);
    }

    const config = await this.modelsService.getSparringConfig();
    const debuggerAgent = await this.agentModel.findOne({ agentCode: 'DEBUGGER' }).exec();
    const architectAgent = await this.agentModel.findOne({ agentCode: 'ARCHITECT' }).exec();

    const createdQuestions: CrossQuestion[] = [];

    // Dexter - Debugger Cross-Question
    if (debuggerAgent) {
      const modelId = config.agentModelMap?.DEBUGGER || 'google/gemma-4-31b-it:free';
      const questionText = await this.generateAgentText(
        modelId,
        debuggerAgent.systemPrompt,
        `A developer submitted this trouble:\nTitle: "${issue.title}"\nContent: "${issue.content}"\n${issue.codeSnippet ? `Code: "${issue.codeSnippet}"` : ''}\n\nAsk 1 sharp, highly technical cross-question to uncover missing reproduction steps, runtime environment, or stack trace details. Output ONLY the question, nothing else.`,
        `Could you share the exact error stack trace or indicate if this occurs under high concurrency or immediate bootstrap?`
      );

      const cq = new this.cqModel({
        issueId: issue._id,
        authorId: debuggerAgent.userId,
        authorType: 'AI_AGENT',
        agentCode: 'DEBUGGER',
        questionText: questionText.trim(),
        codeContext: issue.codeSnippet || '',
        status: QuestionStatus.PENDING,
      });
      await cq.save();
      createdQuestions.push(cq);
    }

    // Ada - Architect Cross-Question
    if (architectAgent) {
      const modelId = config.agentModelMap?.ARCHITECT || 'anthropic/claude-3.5-sonnet';
      const questionText = await this.generateAgentText(
        modelId,
        architectAgent.systemPrompt,
        `A developer submitted this trouble:\nTitle: "${issue.title}"\nContent: "${issue.content}"\n\nAsk 1 concise architectural cross-question regarding data boundaries, module dependencies, or lifecycle management. Output ONLY the question, nothing else.`,
        `Are there multiple instances or microservices sharing this state, or is this isolated to a single process worker?`
      );

      const cq = new this.cqModel({
        issueId: issue._id,
        authorId: architectAgent.userId,
        authorType: 'AI_AGENT',
        agentCode: 'ARCHITECT',
        questionText: questionText.trim(),
        codeContext: issue.codeSnippet || '',
        status: QuestionStatus.PENDING,
      });
      await cq.save();
      createdQuestions.push(cq);
    }

    // Update issue status to CROSS_EXAMINING
    issue.status = IssueStatus.CROSS_EXAMINING;
    await issue.save();

    return createdQuestions;
  }

  /**
   * Phase 2: AI Agents Generate Opinions & Proposed Solutions
   */
  async generateOpinions(issueId: string): Promise<Opinion[]> {
    const issue = await this.issueModel.findById(issueId).exec();
    if (!issue) {
      throw new NotFoundException(`Issue ${issueId} not found`);
    }

    const answeredCQs = await this.cqModel.find({ issueId: issue._id, status: QuestionStatus.ANSWERED }).exec();
    const answersContext = answeredCQs.map(q => `Agent Asked: ${q.questionText}\nDev Answered: ${q.answerText}`).join('\n\n');

    const config = await this.modelsService.getSparringConfig();
    const createdOpinions: Opinion[] = [];

    // 1. Debugger Agent Solution
    const debuggerAgent = await this.agentModel.findOne({ agentCode: 'DEBUGGER' }).exec();
    if (debuggerAgent) {
      const modelId = config.agentModelMap?.DEBUGGER || 'google/gemma-4-31b-it:free';
      const prompt = `Trouble: "${issue.title}"\nDetails: "${issue.content}"\n${answersContext ? `Developer Clues:\n${answersContext}\n` : ''}\nAs Dexter (Debugger), provide:\n1. Root cause explanation\n2. Concise code fix snippet\n\nFormat your response as:\nTITLE: <short fix title>\nEXPLANATION: <detailed explanation>\nCODE:\n<code>`;

      const response = await this.generateAgentText(
        modelId,
        debuggerAgent.systemPrompt,
        prompt,
        `TITLE: Add explicit listener cleanup on connection tear-down\nEXPLANATION: The retained socket event handlers hold closures in memory. Adding an explicit close listener unbinds callbacks and lets GC collect allocated buffers.\nCODE:\nws.once('close', () => {\n  ws.removeAllListeners('message');\n  ws.removeAllListeners('error');\n});`
      );

      const parsed = this.parseOpinionResponse(response);
      const op = new this.opinionModel({
        issueId: issue._id,
        authorId: debuggerAgent.userId,
        authorType: 'AI_AGENT',
        agentCode: 'DEBUGGER',
        title: parsed.title || 'Targeted Root Cause Fix',
        content: parsed.explanation || response,
        codeBlock: parsed.code || '',
        confidenceScore: 0.95,
        isAccepted: false,
      });
      await op.save();
      createdOpinions.push(op);
    }

    // 2. Architect Agent Solution
    const architectAgent = await this.agentModel.findOne({ agentCode: 'ARCHITECT' }).exec();
    if (architectAgent) {
      const modelId = config.agentModelMap?.ARCHITECT || 'anthropic/claude-3.5-sonnet';
      const prompt = `Trouble: "${issue.title}"\nDetails: "${issue.content}"\nAs Ada (Architect), propose a structural pattern or architectural decoupling.\n\nFormat your response as:\nTITLE: <pattern title>\nEXPLANATION: <structural justification>\nCODE:\n<code>`;

      const response = await this.generateAgentText(
        modelId,
        architectAgent.systemPrompt,
        prompt,
        `TITLE: Decouple socket session state using WeakMap registry\nEXPLANATION: Rather than attaching state directly to long-lived instance references, wrap session metadata in a WeakMap registry for automatic reclamation.\nCODE:\nconst sessionRegistry = new WeakMap();\nexport function registerSession(socket, data) {\n  sessionRegistry.set(socket, { ...data, initiatedAt: Date.now() });\n}`
      );

      const parsed = this.parseOpinionResponse(response);
      const op = new this.opinionModel({
        issueId: issue._id,
        authorId: architectAgent.userId,
        authorType: 'AI_AGENT',
        agentCode: 'ARCHITECT',
        title: parsed.title || 'Architectural Decoupling Pattern',
        content: parsed.explanation || response,
        codeBlock: parsed.code || '',
        confidenceScore: 0.89,
        isAccepted: false,
      });
      await op.save();
      createdOpinions.push(op);
    }

    return createdOpinions;
  }

  /**
   * Phase 3: AI Agents Spar & Critique Opinions
   */
  async sparDebate(issueId: string, opinionId: string): Promise<Comment[]> {
    const opinion = await this.opinionModel.findById(opinionId).exec();
    if (!opinion) {
      throw new NotFoundException(`Opinion ${opinionId} not found`);
    }

    const config = await this.modelsService.getSparringConfig();
    const securityAgent = await this.agentModel.findOne({ agentCode: 'SECURITY' }).exec();
    const perfAgent = await this.agentModel.findOne({ agentCode: 'PERFORMANCE' }).exec();

    const createdComments: Comment[] = [];

    // Security Agent Critique
    if (securityAgent) {
      const modelId = config.agentModelMap?.SECURITY || 'meta-llama/llama-3.1-70b-instruct';
      const critiqueText = await this.generateAgentText(
        modelId,
        securityAgent.systemPrompt,
        `Review this proposed solution by ${opinion.agentCode}:\nTitle: ${opinion.title}\nContent: ${opinion.content}\nCode: ${opinion.codeBlock}\n\nProvide 1 concise security audit critique or endorsement. Keep it under 2 sentences.`,
        `Audit Notice: Ensure timeouts on handshake teardown don't leave lingering unauthenticated socket handles open to slowloris denial-of-service.`
      );

      const comment = new this.commentModel({
        targetType: CommentTargetType.OPINION,
        targetId: opinion._id,
        authorId: securityAgent.userId,
        authorType: 'AI_AGENT',
        agentCode: 'SECURITY',
        content: critiqueText.trim(),
      });
      await comment.save();
      createdComments.push(comment);
    }

    // Performance Agent Critique
    if (perfAgent) {
      const modelId = config.agentModelMap?.PERFORMANCE || 'mistralai/codestral-2501';
      const perfText = await this.generateAgentText(
        modelId,
        perfAgent.systemPrompt,
        `Review this proposed solution by ${opinion.agentCode} for runtime performance and memory overhead:\nTitle: ${opinion.title}\nContent: ${opinion.content}\n\nProvide 1 concise performance verification. Keep it under 2 sentences.`,
        `Performance Endorsement: Event listener deregistration immediately reduces GC pressure and halts heap climb across client disconnection cycles.`
      );

      const comment = new this.commentModel({
        targetType: CommentTargetType.OPINION,
        targetId: opinion._id,
        authorId: perfAgent.userId,
        authorType: 'AI_AGENT',
        agentCode: 'PERFORMANCE',
        content: perfText.trim(),
      });
      await comment.save();
      createdComments.push(comment);
    }

    return createdComments;
  }

  /**
   * Helper: Calls LangChain ChatOpenAI or falls back to persona intelligent response
   */
  private async generateAgentText(
    modelId: string,
    systemPrompt: string,
    userPrompt: string,
    fallbackText: string,
  ): Promise<string> {
    const chatModel = this.createChatModel(modelId);
    if (!chatModel) {
      return fallbackText;
    }

    try {
      const response = await chatModel.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt),
      ]);
      const content = response.content;
      if (typeof content === 'string' && content.trim().length > 0) {
        return content.trim();
      }
      return fallbackText;
    } catch (error: any) {
      this.logger.warn(
        `LangChain call to OpenRouter with model ${modelId} failed (${error.message}). Using intelligent persona fallback.`
      );
      return fallbackText;
    }
  }

  private parseOpinionResponse(text: string) {
    let title = '';
    let explanation = '';
    let code = '';

    const titleMatch = text.match(/TITLE:\s*(.+)/i);
    if (titleMatch) title = titleMatch[1].trim();

    const codeMatch = text.match(/```(?:[\w]*\n)?([\s\S]*?)```/) || text.match(/CODE:\s*([\s\S]*)/i);
    if (codeMatch) code = codeMatch[1].trim();

    const explMatch = text.match(/EXPLANATION:\s*([\s\S]*?)(?:CODE:|$)/i);
    if (explMatch) {
      explanation = explMatch[1].trim();
    } else {
      explanation = text.replace(/TITLE:.*?\n/i, '').replace(/CODE:[\s\S]*/i, '').trim();
    }

    return { title, explanation, code };
  }
}
