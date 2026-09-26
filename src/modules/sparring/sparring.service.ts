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
import { EvolutionService } from '../organisms/evolution.service';

export interface SparringStreamEvent {
  type:
    | 'init'
    | 'phase_start'
    | 'agent_start'
    | 'token'
    | 'agent_done'
    | 'phase_done'
    | 'complete'
    | 'error';
  phase?: 'CROSS_EXAMINE' | 'OPINIONS' | 'DEBATE';
  agentCode?: string;
  agentName?: string;
  role?: string;
  token?: string;
  text?: string;
  targetOpinionTitle?: string;
  data?: any;
}

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
    private readonly evolutionService: EvolutionService,
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

  private normalizeModelSlug(modelId: string): string {
    const slugMap: Record<string, string> = {
      'anthropic/claude-3.5-sonnet': 'anthropic/claude-sonnet-4.5',
      'anthropic/claude-3-5-sonnet': 'anthropic/claude-sonnet-4.5',
      'mistralai/codestral-2501': 'mistralai/codestral-2508',
      'google/gemma-4-31b-it:free': 'openai/gpt-4o-mini',
      'google/gemma-4-26b-a4b-it:free': 'openai/gpt-4o-mini',
    };

    return slugMap[modelId] || modelId;
  }

  private createChatModel(modelName: string, temperature = 0.7): ChatOpenAI | null {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      this.logger.warn('OpenRouter API key not configured. Fallback generator will be used.');
      return null;
    }

    const resolvedModel = this.normalizeModelSlug(modelName);

    try {
      return new ChatOpenAI({
        model: resolvedModel,
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
      this.logger.error(`Error initializing ChatOpenAI with model ${resolvedModel}: ${err.message}`);
      return null;
    }
  }

  /**
   * Adaptive Domain Detection: Identifies whether an issue is Technical (code/bug) or General (opinion/real-world)
   */
  private detectDomain(issue: { title: string; content: string; codeSnippet?: string; tags?: string[] }): 'TECHNICAL' | 'GENERAL' {
    if (issue.codeSnippet && issue.codeSnippet.trim().length > 0) {
      return 'TECHNICAL';
    }

    const techKeywords = [
      'javascript', 'typescript', 'python', 'java', 'c++', 'c#', 'golang', 'rust',
      'react', 'angular', 'vue', 'nextjs', 'nestjs', 'express', 'node', 'nodejs',
      'mongodb', 'postgres', 'sql', 'mysql', 'redis', 'docker', 'kubernetes', 'aws',
      'git', 'github', 'npm', 'yarn', 'pnpm', 'api', 'http', 'rest', 'graphql',
      'stack trace', 'typeerror', 'exception', 'syntaxerror', 'memory leak',
      'undefined', 'nullpointer', 'function', 'class', 'const', 'import', 'async', 'await',
      'compiler', 'runtime', 'segfault', 'endpoint', 'webhook', 'json', 'websocket'
    ];

    const tags = issue.tags || [];
    const hasTechTag = tags.some((t) => techKeywords.includes(t.toLowerCase().trim()));
    if (hasTechTag) {
      return 'TECHNICAL';
    }

    const combinedText = `${issue.title} ${issue.content}`.toLowerCase();
    const matchCount = techKeywords.filter((kw) => combinedText.includes(kw)).length;
    if (matchCount >= 2) {
      return 'TECHNICAL';
    }

    return 'GENERAL';
  }

  /**
   * Phase 1: AI Agents Cross-Examine the Developer Trouble or General Topic
   */
  async crossExamine(issueId: string): Promise<CrossQuestion[]> {
    const issue = await this.issueModel.findById(issueId).exec();
    if (!issue) {
      throw new NotFoundException(`Issue ${issueId} not found`);
    }

    const domain = this.detectDomain(issue);
    const config = await this.modelsService.getSparringConfig();
    const debuggerAgent = await this.agentModel.findOne({ agentCode: 'DEBUGGER' }).exec();
    const architectAgent = await this.agentModel.findOne({ agentCode: 'ARCHITECT' }).exec();

    const createdQuestions: CrossQuestion[] = [];

    // Dexter - Debugger / Root Cause Cross-Question
    if (debuggerAgent) {
      const modelId = config.agentModelMap?.DEBUGGER || 'openai/gpt-4o-mini';
      let prompt: string;
      let fallbackText: string;

      if (domain === 'TECHNICAL') {
        prompt = `A developer submitted this trouble:\nTitle: "${issue.title}"\nContent: "${issue.content}"\n${issue.codeSnippet ? `Code: "${issue.codeSnippet}"` : ''}\n\nAsk 1 sharp, highly technical cross-question to uncover missing reproduction steps, runtime environment, or stack trace details. Output ONLY the question, nothing else.`;
        fallbackText = `Could you share the exact error stack trace or indicate if this occurs under high concurrency or immediate bootstrap?`;
      } else {
        prompt = `A user started a discussion on this topic:\nTitle: "${issue.title}"\nContent: "${issue.content}"\n\nAs Dexter (Investigation & Fact-Finding Specialist), ask 1 sharp, thoughtful cross-question to investigate key context, severity, location, or circumstances. Do NOT mention code, programming, software bugs, or stack traces. Output ONLY the question, nothing else.`;
        fallbackText = `What specific circumstances, severity, or immediate challenges are you currently dealing with regarding this situation?`;
      }

      const questionText = await this.generateAgentText(
        modelId,
        debuggerAgent.systemPrompt,
        prompt,
        fallbackText,
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

    // Ada - Architect / Strategic Cross-Question
    if (architectAgent) {
      const modelId = config.agentModelMap?.ARCHITECT || 'meta-llama/llama-3.3-70b-instruct';
      let prompt: string;
      let fallbackText: string;

      if (domain === 'TECHNICAL') {
        prompt = `A developer submitted this trouble:\nTitle: "${issue.title}"\nContent: "${issue.content}"\n\nAsk 1 concise architectural cross-question regarding data boundaries, module dependencies, or lifecycle management. Output ONLY the question, nothing else.`;
        fallbackText = `Are there multiple instances or microservices sharing this state, or is this isolated to a single process worker?`;
      } else {
        prompt = `A user started a discussion on this topic:\nTitle: "${issue.title}"\nContent: "${issue.content}"\n\nAs Ada (Strategic Architect), ask 1 thoughtful cross-question exploring the broader implications, overall strategy, contingency plans, or alternative perspectives. Do NOT mention code, programming, software bugs, or APIs. Output ONLY the question, nothing else.`;
        fallbackText = `What contingency plans or long-term considerations are currently in place to manage the broader impact of this situation?`;
      }

      const questionText = await this.generateAgentText(
        modelId,
        architectAgent.systemPrompt,
        prompt,
        fallbackText,
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
   * Phase 2: AI Agents Generate Opinions & Proposed Solutions / Strategies
   */
  async generateOpinions(issueId: string): Promise<Opinion[]> {
    const issue = await this.issueModel.findById(issueId).exec();
    if (!issue) {
      throw new NotFoundException(`Issue ${issueId} not found`);
    }

    const domain = this.detectDomain(issue);
    const answeredCQs = await this.cqModel.find({ issueId: issue._id, status: QuestionStatus.ANSWERED }).exec();
    const answersContext = answeredCQs.map(q => `Agent Asked: ${q.questionText}\nDev Answered: ${q.answerText}`).join('\n\n');

    const config = await this.modelsService.getSparringConfig();
    const createdOpinions: Opinion[] = [];

    // 1. Debugger / Pragmatist Agent Solution
    const debuggerAgent = await this.agentModel.findOne({ agentCode: 'DEBUGGER' }).exec();
    if (debuggerAgent) {
      const modelId = config.agentModelMap?.DEBUGGER || 'openai/gpt-4o-mini';
      let prompt: string;
      let fallbackText: string;

      if (domain === 'TECHNICAL') {
        prompt = `Trouble: "${issue.title}"\nDetails: "${issue.content}"\n${answersContext ? `Developer Clues:\n${answersContext}\n` : ''}\nAs Dexter (Debugger), provide:\n1. Root cause explanation\n2. Concise code fix snippet\n\nFormat your response as:\nTITLE: <short fix title>\nEXPLANATION: <detailed explanation>\nCODE:\n<code>`;
        fallbackText = `TITLE: Add explicit listener cleanup on connection tear-down\nEXPLANATION: The retained socket event handlers hold closures in memory. Adding an explicit close listener unbinds callbacks and lets GC collect allocated buffers.\nCODE:\nws.once('close', () => {\n  ws.removeAllListeners('message');\n  ws.removeAllListeners('error');\n});`;
      } else {
        prompt = `Topic: "${issue.title}"\nDetails: "${issue.content}"\n${answersContext ? `Additional Context:\n${answersContext}\n` : ''}\nAs Dexter (Investigation & Pragmatic Specialist), provide a clear, practical, fact-based opinion or assessment of this topic. Do NOT mention code, programming, or software. Provide actionable real-world steps.\n\nFormat your response as:\nTITLE: <concise title>\nEXPLANATION: <detailed practical opinion>\nACTION_PLAN:\n<actionable steps or key takeaways>`;
        fallbackText = `TITLE: Secure Immediate Safety and Monitor Developing Conditions\nEXPLANATION: In severe weather events, the immediate priority is personal safety, securing loose outdoor items, and staying informed through local emergency broadcasts before conditions deteriorate.\nACTION_PLAN:\n- Stay indoors away from windows\n- Keep emergency flashlights and backup power ready\n- Monitor official meteorological alerts`;
      }

      const response = await this.generateAgentText(
        modelId,
        debuggerAgent.systemPrompt,
        prompt,
        fallbackText,
      );

      const parsed = this.parseOpinionResponse(response);
      const op = new this.opinionModel({
        issueId: issue._id,
        authorId: debuggerAgent.userId,
        authorType: 'AI_AGENT',
        agentCode: 'DEBUGGER',
        title: parsed.title || (domain === 'TECHNICAL' ? 'Targeted Root Cause Fix' : 'Pragmatic Assessment'),
        content: parsed.explanation || response,
        codeBlock: parsed.code || '',
        confidenceScore: 0.95,
        isAccepted: false,
      });
      await op.save();
      createdOpinions.push(op);
    }

    // 2. Architect / Strategist Agent Solution
    const architectAgent = await this.agentModel.findOne({ agentCode: 'ARCHITECT' }).exec();
    if (architectAgent) {
      const modelId = config.agentModelMap?.ARCHITECT || 'meta-llama/llama-3.3-70b-instruct';
      let prompt: string;
      let fallbackText: string;

      if (domain === 'TECHNICAL') {
        prompt = `Trouble: "${issue.title}"\nDetails: "${issue.content}"\nAs Ada (Architect), propose a structural pattern or architectural decoupling.\n\nFormat your response as:\nTITLE: <pattern title>\nEXPLANATION: <structural justification>\nCODE:\n<code>`;
        fallbackText = `TITLE: Decouple socket session state using WeakMap registry\nEXPLANATION: Rather than attaching state directly to long-lived instance references, wrap session metadata in a WeakMap registry for automatic reclamation.\nCODE:\nconst sessionRegistry = new WeakMap();\nexport function registerSession(socket, data) {\n  sessionRegistry.set(socket, { ...data, initiatedAt: Date.now() });\n}`;
      } else {
        prompt = `Topic: "${issue.title}"\nDetails: "${issue.content}"\nAs Ada (Strategic Architect), propose a comprehensive strategy, contingency framework, or overarching perspective on this situation. Do NOT mention software, programming, or code.\n\nFormat your response as:\nTITLE: <strategy title>\nEXPLANATION: <structured strategic perspective>\nACTION_PLAN:\n<structural framework or phased response>`;
        fallbackText = `TITLE: Multi-Phase Contingency and Continuity Framework\nEXPLANATION: Managing unpredictable external events requires a layered approach: immediate hazard mitigation, communication continuity, and post-event resilience planning.\nACTION_PLAN:\n- Phase 1: Establish resilient communication lines\n- Phase 2: Safeguard critical resources\n- Phase 3: Post-incident assessment and recovery`;
      }

      const response = await this.generateAgentText(
        modelId,
        architectAgent.systemPrompt,
        prompt,
        fallbackText,
      );

      const parsed = this.parseOpinionResponse(response);
      const op = new this.opinionModel({
        issueId: issue._id,
        authorId: architectAgent.userId,
        authorType: 'AI_AGENT',
        agentCode: 'ARCHITECT',
        title: parsed.title || (domain === 'TECHNICAL' ? 'Architectural Decoupling Pattern' : 'Strategic Continuity Framework'),
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

    const issue = await this.issueModel.findById(issueId).exec();
    const domain = issue ? this.detectDomain(issue) : 'TECHNICAL';

    const config = await this.modelsService.getSparringConfig();
    const securityAgent = await this.agentModel.findOne({ agentCode: 'SECURITY' }).exec();
    const perfAgent = await this.agentModel.findOne({ agentCode: 'PERFORMANCE' }).exec();

    const createdComments: Comment[] = [];

    // Security / Risk Agent Critique
    if (securityAgent) {
      const modelId = config.agentModelMap?.SECURITY || 'deepseek/deepseek-chat';
      let prompt: string;
      let fallbackText: string;

      if (domain === 'TECHNICAL') {
        prompt = `Review this proposed solution by ${opinion.agentCode}:\nTitle: ${opinion.title}\nContent: ${opinion.content}\nCode: ${opinion.codeBlock}\n\nProvide 1 concise security audit critique or endorsement. Keep it under 2 sentences.`;
        fallbackText = `Audit Notice: Ensure timeouts on handshake teardown don't leave lingering unauthenticated socket handles open to slowloris denial-of-service.`;
      } else {
        prompt = `Review this proposed opinion on "${issue?.title}" by ${opinion.agentCode}:\nTitle: ${opinion.title}\nContent: ${opinion.content}\n\nAs Sentinel (Safety & Risk Auditor), provide 1 concise safety critique, vulnerability, or risk evaluation. Do NOT mention software, code, or IT vulnerabilities. Keep it under 2 sentences.`;
        fallbackText = `Safety Notice: Ensure physical hazard checks (downed lines, structural weaknesses) precede any outdoor assessment once the immediate event subsides.`;
      }

      const critiqueText = await this.generateAgentText(
        modelId,
        securityAgent.systemPrompt,
        prompt,
        fallbackText,
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

    // Performance / Efficiency Agent Critique
    if (perfAgent) {
      const modelId = config.agentModelMap?.PERFORMANCE || 'mistralai/codestral-2508';
      let prompt: string;
      let fallbackText: string;

      if (domain === 'TECHNICAL') {
        prompt = `Review this proposed solution by ${opinion.agentCode} for runtime performance and memory overhead:\nTitle: ${opinion.title}\nContent: ${opinion.content}\n\nProvide 1 concise performance verification. Keep it under 2 sentences.`;
        fallbackText = `Performance Endorsement: Event listener deregistration immediately reduces GC pressure and halts heap climb across client disconnection cycles.`;
      } else {
        prompt = `Review this proposed opinion on "${issue?.title}" by ${opinion.agentCode}:\nTitle: ${opinion.title}\nContent: ${opinion.content}\n\nAs Turbo (Efficiency & Execution Specialist), provide 1 concise efficiency or execution critique focusing on quick response, resource conservation, and practical impact. Do NOT mention software or code. Keep it under 2 sentences.`;
        fallbackText = `Efficiency Evaluation: Prioritize high-impact immediate preparations first to conserve battery, water, and heating resources before broader response steps.`;
      }

      const perfText = await this.generateAgentText(
        modelId,
        perfAgent.systemPrompt,
        prompt,
        fallbackText,
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

    // Drive organism evolution and mutation from this debate
    this.evolutionService
      .recordSparringEngagement({
        issueId: (opinion as any).issueId?.toString() || '',
        issueTitle: issue?.title || 'Trouble Debate',
        domain: this.detectDomain(issue || ({} as any)),
        participants: [
          { agentCode: 'SECURITY', action: 'CRITIQUE' },
          { agentCode: 'PERFORMANCE', action: 'CRITIQUE' },
        ],
      })
      .catch((err) => {
        this.logger.warn(`Failed to record debate evolution: ${err.message}`);
      });

    return createdComments;
  }

  /**
   * Helper: Calls LangChain ChatOpenAI (with streaming if onToken provided) or falls back to persona intelligent response
   */
  private async generateAgentText(
    modelId: string,
    systemPrompt: string,
    userPrompt: string,
    fallbackText: string,
    onToken?: (token: string) => void,
  ): Promise<string> {
    const primaryModel = this.createChatModel(modelId);
    if (primaryModel) {
      try {
        if (onToken) {
          const stream = await primaryModel.stream([
            new SystemMessage(systemPrompt),
            new HumanMessage(userPrompt),
          ]);
          let fullContent = '';
          for await (const chunk of stream) {
            const token = typeof chunk.content === 'string' ? chunk.content : '';
            if (token) {
              fullContent += token;
              onToken(token);
            }
          }
          if (fullContent.trim().length > 0) {
            return fullContent.trim();
          }
        } else {
          const response = await primaryModel.invoke([
            new SystemMessage(systemPrompt),
            new HumanMessage(userPrompt),
          ]);
          const content = response.content;
          if (typeof content === 'string' && content.trim().length > 0) {
            return content.trim();
          }
        }
      } catch (error: any) {
        this.logger.warn(
          `Primary model ${modelId} failed (${error.message}). Attempting failover model...`
        );
      }
    }

    // Attempt failover to high-availability model (gpt-4o-mini)
    if (modelId !== 'openai/gpt-4o-mini') {
      const failoverModel = this.createChatModel('openai/gpt-4o-mini');
      if (failoverModel) {
        try {
          if (onToken) {
            const stream = await failoverModel.stream([
              new SystemMessage(systemPrompt),
              new HumanMessage(userPrompt),
            ]);
            let fullContent = '';
            for await (const chunk of stream) {
              const token = typeof chunk.content === 'string' ? chunk.content : '';
              if (token) {
                fullContent += token;
                onToken(token);
              }
            }
            if (fullContent.trim().length > 0) {
              return fullContent.trim();
            }
          } else {
            const response = await failoverModel.invoke([
              new SystemMessage(systemPrompt),
              new HumanMessage(userPrompt),
            ]);
            const content = response.content;
            if (typeof content === 'string' && content.trim().length > 0) {
              return content.trim();
            }
          }
        } catch (err: any) {
          this.logger.warn(`Failover model failed (${err.message}). Using intelligent persona fallback.`);
        }
      }
    }

    // Simulated token streaming if fallbackText is used
    if (onToken) {
      const words = fallbackText.split(' ');
      for (const word of words) {
        onToken(word + ' ');
        await new Promise((r) => setTimeout(r, 20));
      }
    }

    return fallbackText;
  }

  /**
   * Stream the full 3-phase AI agent sparring cycle in real time token-by-token
   */
  async streamFullSparring(
    issueId: string,
    emit: (event: SparringStreamEvent) => void,
  ): Promise<void> {
    const issue = await this.issueModel.findById(issueId).exec();
    if (!issue) {
      throw new NotFoundException(`Issue ${issueId} not found`);
    }

    const domain = this.detectDomain(issue);
    emit({
      type: 'init',
      data: {
        issueId: issue._id,
        issueTitle: issue.title,
        domain,
        totalPhases: 3,
      },
    });

    const config = await this.modelsService.getSparringConfig();
    const debuggerAgent = await this.agentModel.findOne({ agentCode: 'DEBUGGER' }).exec();
    const architectAgent = await this.agentModel.findOne({ agentCode: 'ARCHITECT' }).exec();
    const securityAgent = await this.agentModel.findOne({ agentCode: 'SECURITY' }).exec();
    const perfAgent = await this.agentModel.findOne({ agentCode: 'PERFORMANCE' }).exec();

    // ----------------------------------------------------
    // PHASE 1: Cross-Examination
    // ----------------------------------------------------
    emit({
      type: 'phase_start',
      phase: 'CROSS_EXAMINE',
      text: 'Phase 1: Agent Cross-Examination',
    });

    const createdQuestions: CrossQuestion[] = [];

    // Dexter
    if (debuggerAgent) {
      emit({
        type: 'agent_start',
        phase: 'CROSS_EXAMINE',
        agentCode: 'DEBUGGER',
        agentName: 'Dexter',
        role: domain === 'TECHNICAL' ? 'Root Cause Debugger' : 'Investigation Specialist',
      });

      const modelId = config.agentModelMap?.DEBUGGER || 'openai/gpt-4o-mini';
      let prompt: string;
      let fallbackText: string;

      if (domain === 'TECHNICAL') {
        prompt = `A developer submitted this trouble:\nTitle: "${issue.title}"\nContent: "${issue.content}"\n${issue.codeSnippet ? `Code: "${issue.codeSnippet}"` : ''}\n\nAsk 1 sharp, highly technical cross-question to uncover missing reproduction steps, runtime environment, or stack trace details. Output ONLY the question, nothing else.`;
        fallbackText = `Could you share the exact error stack trace or indicate if this occurs under high concurrency or immediate bootstrap?`;
      } else {
        prompt = `A user started a discussion on this topic:\nTitle: "${issue.title}"\nContent: "${issue.content}"\n\nAs Dexter (Investigation & Fact-Finding Specialist), ask 1 sharp, thoughtful cross-question to investigate key context, severity, location, or circumstances. Do NOT mention code, programming, software bugs, or stack traces. Output ONLY the question, nothing else.`;
        fallbackText = `What specific circumstances, severity, or immediate challenges are you currently dealing with regarding this situation?`;
      }

      const questionText = await this.generateAgentText(
        modelId,
        debuggerAgent.systemPrompt,
        prompt,
        fallbackText,
        (token) => emit({ type: 'token', phase: 'CROSS_EXAMINE', agentCode: 'DEBUGGER', token }),
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

      emit({
        type: 'agent_done',
        phase: 'CROSS_EXAMINE',
        agentCode: 'DEBUGGER',
        data: cq,
      });
    }

    // Ada
    if (architectAgent) {
      emit({
        type: 'agent_start',
        phase: 'CROSS_EXAMINE',
        agentCode: 'ARCHITECT',
        agentName: 'Ada',
        role: domain === 'TECHNICAL' ? 'System Architect' : 'Strategic Architect',
      });

      const modelId = config.agentModelMap?.ARCHITECT || 'meta-llama/llama-3.3-70b-instruct';
      let prompt: string;
      let fallbackText: string;

      if (domain === 'TECHNICAL') {
        prompt = `A developer submitted this trouble:\nTitle: "${issue.title}"\nContent: "${issue.content}"\n\nAsk 1 concise architectural cross-question regarding data boundaries, module dependencies, or lifecycle management. Output ONLY the question, nothing else.`;
        fallbackText = `Are there multiple instances or microservices sharing this state, or is this isolated to a single process worker?`;
      } else {
        prompt = `A user started a discussion on this topic:\nTitle: "${issue.title}"\nContent: "${issue.content}"\n\nAs Ada (Strategic Architect), ask 1 thoughtful cross-question exploring the broader implications, overall strategy, contingency plans, or alternative perspectives. Do NOT mention code, programming, software bugs, or APIs. Output ONLY the question, nothing else.`;
        fallbackText = `What contingency plans or long-term considerations are currently in place to manage the broader impact of this situation?`;
      }

      const questionText = await this.generateAgentText(
        modelId,
        architectAgent.systemPrompt,
        prompt,
        fallbackText,
        (token) => emit({ type: 'token', phase: 'CROSS_EXAMINE', agentCode: 'ARCHITECT', token }),
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

      emit({
        type: 'agent_done',
        phase: 'CROSS_EXAMINE',
        agentCode: 'ARCHITECT',
        data: cq,
      });
    }

    issue.status = IssueStatus.CROSS_EXAMINING;
    await issue.save();

    emit({
      type: 'phase_done',
      phase: 'CROSS_EXAMINE',
      data: { count: createdQuestions.length },
    });

    // ----------------------------------------------------
    // PHASE 2: Opinions & Solutions / Action Plans
    // ----------------------------------------------------
    emit({
      type: 'phase_start',
      phase: 'OPINIONS',
      text: domain === 'TECHNICAL' ? 'Phase 2: Solutions & Architectures' : 'Phase 2: Opinions & Action Plans',
    });

    const answeredCQs = await this.cqModel
      .find({ issueId: issue._id, status: QuestionStatus.ANSWERED })
      .exec();
    const answersContext = answeredCQs
      .map((q) => `Agent Asked: ${q.questionText}\nDev Answered: ${q.answerText}`)
      .join('\n\n');

    const createdOpinions: Opinion[] = [];

    // Dexter's Opinion
    if (debuggerAgent) {
      emit({
        type: 'agent_start',
        phase: 'OPINIONS',
        agentCode: 'DEBUGGER',
        agentName: 'Dexter',
        role: domain === 'TECHNICAL' ? 'Root Cause Fix' : 'Pragmatic Assessment',
      });

      const modelId = config.agentModelMap?.DEBUGGER || 'openai/gpt-4o-mini';
      let prompt: string;
      let fallbackText: string;

      if (domain === 'TECHNICAL') {
        prompt = `Trouble: "${issue.title}"\nDetails: "${issue.content}"\n${answersContext ? `Developer Clues:\n${answersContext}\n` : ''}\nAs Dexter (Debugger), provide:\n1. Root cause explanation\n2. Concise code fix snippet\n\nFormat your response as:\nTITLE: <short fix title>\nEXPLANATION: <detailed explanation>\nCODE:\n<code>`;
        fallbackText = `TITLE: Add explicit listener cleanup on connection tear-down\nEXPLANATION: The retained socket event handlers hold closures in memory. Adding an explicit close listener unbinds callbacks and lets GC collect allocated buffers.\nCODE:\nws.once('close', () => {\n  ws.removeAllListeners('message');\n  ws.removeAllListeners('error');\n});`;
      } else {
        prompt = `Topic: "${issue.title}"\nDetails: "${issue.content}"\n${answersContext ? `Additional Context:\n${answersContext}\n` : ''}\nAs Dexter (Investigation & Pragmatic Specialist), provide a clear, practical, fact-based opinion or assessment of this topic. Do NOT mention code, programming, or software. Provide actionable real-world steps.\n\nFormat your response as:\nTITLE: <concise title>\nEXPLANATION: <detailed practical opinion>\nACTION_PLAN:\n<actionable steps or key takeaways>`;
        fallbackText = `TITLE: Secure Immediate Safety and Monitor Developing Conditions\nEXPLANATION: In severe weather events, the immediate priority is personal safety, securing loose outdoor items, and staying informed through local emergency broadcasts before conditions deteriorate.\nACTION_PLAN:\n- Stay indoors away from windows\n- Keep emergency flashlights and backup power ready\n- Monitor official meteorological alerts`;
      }

      const response = await this.generateAgentText(
        modelId,
        debuggerAgent.systemPrompt,
        prompt,
        fallbackText,
        (token) => emit({ type: 'token', phase: 'OPINIONS', agentCode: 'DEBUGGER', token }),
      );

      const parsed = this.parseOpinionResponse(response);
      const op = new this.opinionModel({
        issueId: issue._id,
        authorId: debuggerAgent.userId,
        authorType: 'AI_AGENT',
        agentCode: 'DEBUGGER',
        title: parsed.title || (domain === 'TECHNICAL' ? 'Targeted Root Cause Fix' : 'Pragmatic Assessment'),
        content: parsed.explanation || response,
        codeBlock: parsed.code || '',
        confidenceScore: 0.95,
        isAccepted: false,
      });
      await op.save();
      createdOpinions.push(op);

      emit({
        type: 'agent_done',
        phase: 'OPINIONS',
        agentCode: 'DEBUGGER',
        data: op,
      });
    }

    // Ada's Opinion
    if (architectAgent) {
      emit({
        type: 'agent_start',
        phase: 'OPINIONS',
        agentCode: 'ARCHITECT',
        agentName: 'Ada',
        role: domain === 'TECHNICAL' ? 'Architectural Decoupling' : 'Strategic Continuity Framework',
      });

      const modelId = config.agentModelMap?.ARCHITECT || 'meta-llama/llama-3.3-70b-instruct';
      let prompt: string;
      let fallbackText: string;

      if (domain === 'TECHNICAL') {
        prompt = `Trouble: "${issue.title}"\nDetails: "${issue.content}"\nAs Ada (Architect), propose a structural pattern or architectural decoupling.\n\nFormat your response as:\nTITLE: <pattern title>\nEXPLANATION: <structural justification>\nCODE:\n<code>`;
        fallbackText = `TITLE: Decouple socket session state using WeakMap registry\nEXPLANATION: Rather than attaching state directly to long-lived instance references, wrap session metadata in a WeakMap registry for automatic reclamation.\nCODE:\nconst sessionRegistry = new WeakMap();\nexport function registerSession(socket, data) {\n  sessionRegistry.set(socket, { ...data, initiatedAt: Date.now() });\n}`;
      } else {
        prompt = `Topic: "${issue.title}"\nDetails: "${issue.content}"\nAs Ada (Strategic Architect), propose a comprehensive strategy, contingency framework, or overarching perspective on this situation. Do NOT mention software, programming, or code.\n\nFormat your response as:\nTITLE: <strategy title>\nEXPLANATION: <structured strategic perspective>\nACTION_PLAN:\n<structural framework or phased response>`;
        fallbackText = `TITLE: Multi-Phase Contingency and Continuity Framework\nEXPLANATION: Managing unpredictable external events requires a layered approach: immediate hazard mitigation, communication continuity, and post-event resilience planning.\nACTION_PLAN:\n- Phase 1: Establish resilient communication lines\n- Phase 2: Safeguard critical resources\n- Phase 3: Post-incident assessment and recovery`;
      }

      const response = await this.generateAgentText(
        modelId,
        architectAgent.systemPrompt,
        prompt,
        fallbackText,
        (token) => emit({ type: 'token', phase: 'OPINIONS', agentCode: 'ARCHITECT', token }),
      );

      const parsed = this.parseOpinionResponse(response);
      const op = new this.opinionModel({
        issueId: issue._id,
        authorId: architectAgent.userId,
        authorType: 'AI_AGENT',
        agentCode: 'ARCHITECT',
        title: parsed.title || (domain === 'TECHNICAL' ? 'Architectural Decoupling Pattern' : 'Strategic Continuity Framework'),
        content: parsed.explanation || response,
        codeBlock: parsed.code || '',
        confidenceScore: 0.89,
        isAccepted: false,
      });
      await op.save();
      createdOpinions.push(op);

      emit({
        type: 'agent_done',
        phase: 'OPINIONS',
        agentCode: 'ARCHITECT',
        data: op,
      });
    }

    emit({
      type: 'phase_done',
      phase: 'OPINIONS',
      data: { count: createdOpinions.length },
    });

    // ----------------------------------------------------
    // PHASE 3: Multi-Agent Sparring Debate & Critiques
    // ----------------------------------------------------
    emit({
      type: 'phase_start',
      phase: 'DEBATE',
      text: 'Phase 3: Cross-Agent Sparring Debate & Critiques',
    });

    const createdComments: Comment[] = [];

    for (const opinion of createdOpinions) {
      // Sentinel Critique
      if (securityAgent) {
        emit({
          type: 'agent_start',
          phase: 'DEBATE',
          agentCode: 'SECURITY',
          agentName: 'Sentinel',
          role: domain === 'TECHNICAL' ? 'Security Auditor' : 'Safety & Risk Auditor',
          targetOpinionTitle: opinion.title,
        });

        const modelId = config.agentModelMap?.SECURITY || 'deepseek/deepseek-chat';
        let prompt: string;
        let fallbackText: string;

        if (domain === 'TECHNICAL') {
          prompt = `Review this proposed solution by ${opinion.agentCode}:\nTitle: ${opinion.title}\nContent: ${opinion.content}\nCode: ${opinion.codeBlock}\n\nProvide 1 concise security audit critique or endorsement. Keep it under 2 sentences.`;
          fallbackText = `Audit Notice: Ensure timeouts on handshake teardown don't leave lingering unauthenticated socket handles open to slowloris denial-of-service.`;
        } else {
          prompt = `Review this proposed opinion on "${issue?.title}" by ${opinion.agentCode}:\nTitle: ${opinion.title}\nContent: ${opinion.content}\n\nAs Sentinel (Safety & Risk Auditor), provide 1 concise safety critique, vulnerability, or risk evaluation. Do NOT mention software, code, or IT vulnerabilities. Keep it under 2 sentences.`;
          fallbackText = `Safety Notice: Ensure physical hazard checks (downed lines, structural weaknesses) precede any outdoor assessment once the immediate event subsides.`;
        }

        const critiqueText = await this.generateAgentText(
          modelId,
          securityAgent.systemPrompt,
          prompt,
          fallbackText,
          (token) => emit({ type: 'token', phase: 'DEBATE', agentCode: 'SECURITY', token }),
        );

        const comment = new this.commentModel({
          targetType: CommentTargetType.OPINION,
          targetId: (opinion as any)._id,
          authorId: securityAgent.userId,
          authorType: 'AI_AGENT',
          agentCode: 'SECURITY',
          content: critiqueText.trim(),
        });
        await comment.save();
        createdComments.push(comment);

        emit({
          type: 'agent_done',
          phase: 'DEBATE',
          agentCode: 'SECURITY',
          data: comment,
        });
      }

      // Turbo Critique
      if (perfAgent) {
        emit({
          type: 'agent_start',
          phase: 'DEBATE',
          agentCode: 'PERFORMANCE',
          agentName: 'Turbo',
          role: domain === 'TECHNICAL' ? 'Performance Optimizer' : 'Execution & Efficiency Specialist',
          targetOpinionTitle: opinion.title,
        });

        const modelId = config.agentModelMap?.PERFORMANCE || 'mistralai/codestral-2508';
        let prompt: string;
        let fallbackText: string;

        if (domain === 'TECHNICAL') {
          prompt = `Review this proposed solution by ${opinion.agentCode} for runtime performance and memory overhead:\nTitle: ${opinion.title}\nContent: ${opinion.content}\n\nProvide 1 concise performance verification. Keep it under 2 sentences.`;
          fallbackText = `Performance Endorsement: Event listener deregistration immediately reduces GC pressure and halts heap climb across client disconnection cycles.`;
        } else {
          prompt = `Review this proposed opinion on "${issue?.title}" by ${opinion.agentCode}:\nTitle: ${opinion.title}\nContent: ${opinion.content}\n\nAs Turbo (Efficiency & Execution Specialist), provide 1 concise efficiency or execution critique focusing on quick response, resource conservation, and practical impact. Do NOT mention software or code. Keep it under 2 sentences.`;
          fallbackText = `Efficiency Evaluation: Prioritize high-impact immediate preparations first to conserve battery, water, and heating resources before broader response steps.`;
        }

        const perfText = await this.generateAgentText(
          modelId,
          perfAgent.systemPrompt,
          prompt,
          fallbackText,
          (token) => emit({ type: 'token', phase: 'DEBATE', agentCode: 'PERFORMANCE', token }),
        );

        const comment = new this.commentModel({
          targetType: CommentTargetType.OPINION,
          targetId: (opinion as any)._id,
          authorId: perfAgent.userId,
          authorType: 'AI_AGENT',
          agentCode: 'PERFORMANCE',
          content: perfText.trim(),
        });
        await comment.save();
        createdComments.push(comment);

        emit({
          type: 'agent_done',
          phase: 'DEBATE',
          agentCode: 'PERFORMANCE',
          data: comment,
        });
      }
    }

    emit({
      type: 'phase_done',
      phase: 'DEBATE',
      data: { count: createdComments.length },
    });

    // Directly drive organism evolution, fitness, and mutation from this battle!
    this.evolutionService
      .recordSparringEngagement({
        issueId: (issue as any)._id.toString(),
        issueTitle: issue.title,
        domain,
        participants: [
          { agentCode: 'DEBUGGER', action: 'QUESTION' },
          { agentCode: 'ARCHITECT', action: 'QUESTION' },
          { agentCode: 'SECURITY', action: 'QUESTION' },
          { agentCode: 'PERFORMANCE', action: 'QUESTION' },
          { agentCode: 'DEBUGGER', action: 'SOLUTION' },
          { agentCode: 'ARCHITECT', action: 'SOLUTION' },
          { agentCode: 'SECURITY', action: 'CRITIQUE' },
          { agentCode: 'PERFORMANCE', action: 'CRITIQUE' },
        ],
      })
      .catch((err) => {
        this.logger.warn(`Failed to record sparring stream evolution: ${err.message}`);
      });

    emit({
      type: 'complete',
      data: {
        questionsCount: createdQuestions.length,
        opinionsCount: createdOpinions.length,
        commentsCount: createdComments.length,
      },
    });
  }

  private parseOpinionResponse(text: string) {
    let title = '';
    let explanation = '';
    let code = '';

    const titleMatch = text.match(/TITLE:\s*([^\n]+)/i);
    if (titleMatch) title = titleMatch[1].trim();

    const codeMatch =
      text.match(/```(?:[\w]*\n)?([\s\S]*?)```/) ||
      text.match(/(?:CODE|ACTION_PLAN|KEY_STEPS):\s*([\s\S]*)/i);
    if (codeMatch) code = codeMatch[1].trim();

    const explMatch = text.match(/EXPLANATION:\s*([\s\S]*?)(?:CODE:|ACTION_PLAN:|KEY_STEPS:|$)/i);
    if (explMatch) {
      explanation = explMatch[1].trim();
    } else {
      explanation = text
        .replace(/TITLE:[^\n]*\n?/i, '')
        .replace(/(?:CODE|ACTION_PLAN|KEY_STEPS):[\s\S]*/i, '')
        .trim();
    }

    return { title, explanation, code };
  }
}
