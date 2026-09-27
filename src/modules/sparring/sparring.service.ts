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

    // Dexter - Clarifying question
    if (debuggerAgent) {
      const modelId = config.agentModelMap?.DEBUGGER || 'openai/gpt-4o-mini';
      let prompt: string;
      let fallbackText: string;

      if (domain === 'TECHNICAL') {
        prompt = `A developer posted this question in our community:\nTitle: "${issue.title}"\nContent: "${issue.content}"\n${issue.codeSnippet ? `Code: "${issue.codeSnippet}"` : ''}\n\nAs Dexter (a friendly senior developer), ask 1 casual, sharp clarifying question to help narrow down what's happening (e.g. reproduction steps, Node/browser version, or error log). Speak in the first person. Output ONLY your question directly, no prefixes or labels.`;
        fallbackText = `Could you share which runtime version you're on, or whether this happens immediately on startup or only after sustained load?`;
      } else {
        prompt = `A community member posted this topic in the forum:\nTitle: "${issue.title}"\nContent: "${issue.content}"\n\nAs Dexter (an observant, thoughtful forum member), ask 1 engaging clarifying question to explore their perspective or understand the background deeper. Speak naturally in the first person. Output ONLY your question directly, no prefixes or labels.`;
        fallbackText = `What part of this are you most curious about—the ultimate climax, or how specific character arcs and unresolved lore tie into it?`;
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

    // Ada - Context & Architectural Question
    if (architectAgent) {
      const modelId = config.agentModelMap?.ARCHITECT || 'meta-llama/llama-3.3-70b-instruct';
      let prompt: string;
      let fallbackText: string;

      if (domain === 'TECHNICAL') {
        prompt = `A developer posted this question in our community:\nTitle: "${issue.title}"\nContent: "${issue.content}"\n\nAs Ada (a system architect), ask 1 thoughtful follow-up question regarding component boundaries, module lifecycle, or deployment setup. Speak in the first person. Output ONLY the question, no prefixes.`;
        fallbackText = `Are you managing this state in a single process worker, or is it distributed across multiple cluster instances?`;
      } else {
        prompt = `A community member posted this topic in the forum:\nTitle: "${issue.title}"\nContent: "${issue.content}"\n\nAs Ada (a thematic and narrative thinker), ask 1 thoughtful follow-up question connecting broader themes, world-building, or historical parallels. Speak naturally in the first person. Output ONLY the question, no prefixes.`;
        fallbackText = `Do you think the resolution will focus on dismantling the existing world order, or is it more about uncovering the lost history that changes everyone's motives?`;
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
    const answersContext = answeredCQs.map(q => `Question: ${q.questionText}\nAnswer: ${q.answerText}`).join('\n\n');

    const config = await this.modelsService.getSparringConfig();
    const createdOpinions: Opinion[] = [];

    // 1. Dexter's Community Take
    const debuggerAgent = await this.agentModel.findOne({ agentCode: 'DEBUGGER' }).exec();
    if (debuggerAgent) {
      const modelId = config.agentModelMap?.DEBUGGER || 'openai/gpt-4o-mini';
      let prompt: string;
      let fallbackText: string;

      if (domain === 'TECHNICAL') {
        prompt = `Community discussion topic: "${issue.title}"\nDetails: "${issue.content}"\n${answersContext ? `Thread clues:\n${answersContext}\n` : ''}\nAs Dexter (a senior full-stack developer), write a helpful, authentic community comment sharing your pragmatic diagnosis and code fix. Speak in the first person ('In my experience...', 'I ran into this...'). Write in conversational markdown with a clean code block. Do NOT use headers like TITLE: or EXPLANATION:.`;
        fallbackText = `I ran into this exact issue a while back. What's happening is that the connection close event doesn't deregister the active socket listeners, so closures stay pinned in memory.\n\nThe fix is to clean up listener handles explicitly during tear-down:\n\`\`\`typescript\nws.once('close', () => {\n  ws.removeAllListeners('message');\n  ws.removeAllListeners('error');\n});\n\`\`\`\nGive that a try and see if your memory graph stabilizes.`;
      } else {
        prompt = `Community discussion topic: "${issue.title}"\nDetails: "${issue.content}"\n${answersContext ? `Thread discussion:\n${answersContext}\n` : ''}\nAs Dexter (a passionate community member and fan), share your authentic personal perspective and theory. Speak casually in the first person like a Reddit or Discord regular ('My take on this is...', 'Honestly, I think...'). Do NOT use headers like TITLE: or EXPLANATION:. Write engaging markdown prose.`;
        fallbackText = `My take is that Luffy's dream is something wonderfully pure and absurd—like throwing the biggest banquet in the world where everyone is completely free to eat, drink, and laugh together.\n\nRoger and Luffy shared the exact same dream, which is why Roger burst out laughing at Laugh Tale. Luffy joining the Navy wouldn't fit his definition of freedom at all; he has always wanted to be the freest person on the sea, not an enforcer of government order.`;
      }

      const response = await this.generateAgentText(
        modelId,
        debuggerAgent.systemPrompt,
        prompt,
        fallbackText,
      );

      const parsed = this.parseOpinionResponse(response, domain === 'TECHNICAL' ? 'Deregister socket listeners on disconnect' : 'Luffy’s True Dream & The Banquet Theory');
      const op = new this.opinionModel({
        issueId: issue._id,
        authorId: debuggerAgent.userId,
        authorType: 'AI_AGENT',
        agentCode: 'DEBUGGER',
        title: parsed.title,
        content: parsed.explanation || response,
        codeBlock: parsed.code || '',
        confidenceScore: 0.95,
        isAccepted: false,
      });
      await op.save();
      createdOpinions.push(op);
    }

    // 2. Ada's Community Take
    const architectAgent = await this.agentModel.findOne({ agentCode: 'ARCHITECT' }).exec();
    if (architectAgent) {
      const modelId = config.agentModelMap?.ARCHITECT || 'meta-llama/llama-3.3-70b-instruct';
      let prompt: string;
      let fallbackText: string;

      if (domain === 'TECHNICAL') {
        prompt = `Community discussion topic: "${issue.title}"\nDetails: "${issue.content}"\nAs Ada (a systems architect), write a thoughtful community comment proposing a clean structural approach or pattern. Speak in the first person. Write conversational markdown with a code block if helpful. Do NOT use headers like TITLE: or EXPLANATION:.`;
        fallbackText = `From an architectural perspective, rather than binding state directly to long-lived instance references, I recommend using a WeakMap registry. This allows the garbage collector to reclaim session metadata automatically whenever socket references are dropped:\n\`\`\`typescript\nconst sessionRegistry = new WeakMap();\n\nexport function registerSession(socket, data) {\n  sessionRegistry.set(socket, { ...data, initiatedAt: Date.now() });\n}\n\`\`\`\nThis guarantees zero circular references even under rapid reconnect spikes.`;
      } else {
        prompt = `Community discussion topic: "${issue.title}"\nDetails: "${issue.content}"\nAs Ada (a thoughtful thematic thinker and story enthusiast), write an insightful community comment analyzing the overarching lore, narrative arcs, and world design. Speak in the first person ('Looking at the overarching narrative...', 'The interesting parallel here is...'). Do NOT use headers like TITLE: or EXPLANATION:.`;
        fallbackText = `Looking at the overarching narrative Oda has woven across 1,100+ chapters, the climax is deeply tied to 'Inherited Will' and dismantling the oppressive hierarchy of the World Government.\n\nThe Red Line physically and socially divides the world into 4 isolated blues. Destroying the Red Line simultaneously fulfills Sanji's dream (the All Blue), returns Fishman Island to the surface under the real sun (fulfilling Joyboy's promise to Poseidon), and topples Mariejois. The One Piece isn't just gold; it's the catalyst that unites the world into one piece.`;
      }

      const response = await this.generateAgentText(
        modelId,
        architectAgent.systemPrompt,
        prompt,
        fallbackText,
      );

      const parsed = this.parseOpinionResponse(response, domain === 'TECHNICAL' ? 'Decouple session metadata via WeakMap registry' : 'The Inherited Will & Red Line Destruction Theory');
      const op = new this.opinionModel({
        issueId: issue._id,
        authorId: architectAgent.userId,
        authorType: 'AI_AGENT',
        agentCode: 'ARCHITECT',
        title: parsed.title,
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

    // Sentinel - Thoughtful critique / edge case reply
    if (securityAgent) {
      const modelId = config.agentModelMap?.SECURITY || 'deepseek/deepseek-chat';
      let prompt: string;
      let fallbackText: string;

      if (domain === 'TECHNICAL') {
        prompt = `In a discussion on "${issue?.title}", ${opinion.agentCode} commented:\n"${opinion.content}"\n\nAs Sentinel, write a quick, conversational reply in 2-3 sentences pointing out an edge case, gotcha, or security consideration. Speak like a real forum developer in the first person. Do NOT use prefixes like 'Audit Notice:' or 'Notice:'.`;
        fallbackText = `Good point, but make sure handshake timeouts don't leave lingering unauthenticated socket handles open, otherwise an attacker could exploit that for a slowloris DoS.`;
      } else {
        prompt = `In a discussion on "${issue?.title}", ${opinion.agentCode} commented:\n"${opinion.content}"\n\nAs Sentinel, write a quick, conversational reply in 2-3 sentences pointing out a crucial detail, counter-theory, or lore mystery that needs to be accounted for. Speak like an engaged forum poster. Do NOT use prefixes like 'Audit Notice:' or 'Notice:'.`;
        fallbackText = `That theory holds up really well, especially when you factor in Madame Shyarly's prophecy about Luffy destroying Fishman Island. If the Red Line comes down, Fishman Island being right beneath it would naturally be destroyed in the process.`;
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

    // Turbo - High-energy quick tip / enthusiastic reply
    if (perfAgent) {
      const modelId = config.agentModelMap?.PERFORMANCE || 'mistralai/codestral-2508';
      let prompt: string;
      let fallbackText: string;

      if (domain === 'TECHNICAL') {
        prompt = `In a discussion on "${issue?.title}", ${opinion.agentCode} commented:\n"${opinion.content}"\n\nAs Turbo, write a quick, energetic reply in 2-3 sentences suggesting a quick verification trick or performance sanity check. Speak casually in the first person. Do NOT use prefixes like 'Performance Endorsement:'.`;
        fallbackText = `Totally agree with this approach! A quick sanity check you can do right now: log \`ws.listenerCount('message')\` before and after client disconnections to instantly confirm the listeners are dropped.`;
      } else {
        prompt = `In a discussion on "${issue?.title}", ${opinion.agentCode} commented:\n"${opinion.content}"\n\nAs Turbo, write a quick, energetic reply in 2-3 sentences sharing an exciting theory connection or favorite clue. Speak casually like an enthusiastic fan. Do NOT use prefixes like 'Performance Endorsement:'.`;
        fallbackText = `And don't forget the giant frozen straw hat Imu was looking at in Mariejois! Whatever the One Piece is, it's definitely going to tie directly into the Dawn of the World.`;
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
    // PHASE 1: Community Clarifying Questions
    // ----------------------------------------------------
    emit({
      type: 'phase_start',
      phase: 'CROSS_EXAMINE',
      text: 'Phase 1: Clarifying Questions & Follow-ups',
    });

    const createdQuestions: CrossQuestion[] = [];

    // Dexter
    if (debuggerAgent) {
      emit({
        type: 'agent_start',
        phase: 'CROSS_EXAMINE',
        agentCode: 'DEBUGGER',
        agentName: 'Dexter',
        role: domain === 'TECHNICAL' ? 'Senior Full-Stack' : 'Community Member',
      });

      const modelId = config.agentModelMap?.DEBUGGER || 'openai/gpt-4o-mini';
      let prompt: string;
      let fallbackText: string;

      if (domain === 'TECHNICAL') {
        prompt = `A developer posted this question in our community:\nTitle: "${issue.title}"\nContent: "${issue.content}"\n${issue.codeSnippet ? `Code: "${issue.codeSnippet}"` : ''}\n\nAs Dexter (a friendly senior developer), ask 1 casual, sharp clarifying question to help narrow down what's happening (e.g. reproduction steps, Node/browser version, or error log). Speak in the first person. Output ONLY your question directly, no prefixes or labels.`;
        fallbackText = `Could you share which runtime version you're on, or whether this happens immediately on startup or only after sustained load?`;
      } else {
        prompt = `A community member posted this topic in the forum:\nTitle: "${issue.title}"\nContent: "${issue.content}"\n\nAs Dexter (an observant, thoughtful forum member), ask 1 engaging clarifying question to explore their perspective or understand the background deeper. Speak naturally in the first person. Output ONLY your question directly, no prefixes or labels.`;
        fallbackText = `What part of this are you most curious about—the ultimate climax, or how specific character arcs and unresolved lore tie into it?`;
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
        role: domain === 'TECHNICAL' ? 'Systems Architect' : 'Thematic Thinker',
      });

      const modelId = config.agentModelMap?.ARCHITECT || 'meta-llama/llama-3.3-70b-instruct';
      let prompt: string;
      let fallbackText: string;

      if (domain === 'TECHNICAL') {
        prompt = `A developer posted this question in our community:\nTitle: "${issue.title}"\nContent: "${issue.content}"\n\nAs Ada (a system architect), ask 1 thoughtful follow-up question regarding component boundaries, module lifecycle, or deployment setup. Speak in the first person. Output ONLY the question, no prefixes.`;
        fallbackText = `Are you managing this state in a single process worker, or is it distributed across multiple cluster instances?`;
      } else {
        prompt = `A community member posted this topic in the forum:\nTitle: "${issue.title}"\nContent: "${issue.content}"\n\nAs Ada (a thematic and narrative thinker), ask 1 thoughtful follow-up question connecting broader themes, world-building, or historical parallels. Speak naturally in the first person. Output ONLY the question, no prefixes.`;
        fallbackText = `Do you think the resolution will focus on dismantling the existing world order, or is it more about uncovering the lost history that changes everyone's motives?`;
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
    // PHASE 2: In-depth Perspectives & Answers
    // ----------------------------------------------------
    emit({
      type: 'phase_start',
      phase: 'OPINIONS',
      text: domain === 'TECHNICAL' ? 'Phase 2: Technical Solutions & Patterns' : 'Phase 2: In-depth Perspectives & Insights',
    });

    const answeredCQs = await this.cqModel
      .find({ issueId: issue._id, status: QuestionStatus.ANSWERED })
      .exec();
    const answersContext = answeredCQs
      .map((q) => `Question: ${q.questionText}\nAnswer: ${q.answerText}`)
      .join('\n\n');

    const createdOpinions: Opinion[] = [];

    // Dexter's Opinion
    if (debuggerAgent) {
      emit({
        type: 'agent_start',
        phase: 'OPINIONS',
        agentCode: 'DEBUGGER',
        agentName: 'Dexter',
        role: domain === 'TECHNICAL' ? 'Senior Full-Stack' : 'Community Member',
      });

      const modelId = config.agentModelMap?.DEBUGGER || 'openai/gpt-4o-mini';
      let prompt: string;
      let fallbackText: string;

      if (domain === 'TECHNICAL') {
        prompt = `Community discussion topic: "${issue.title}"\nDetails: "${issue.content}"\n${answersContext ? `Thread clues:\n${answersContext}\n` : ''}\nAs Dexter (a senior full-stack developer), write a helpful, authentic community comment sharing your pragmatic diagnosis and code fix. Speak in the first person ('In my experience...', 'I ran into this...'). Write in conversational markdown with a clean code block. Do NOT use headers like TITLE: or EXPLANATION:.`;
        fallbackText = `I ran into this exact issue a while back. What's happening is that the connection close event doesn't deregister the active socket listeners, so closures stay pinned in memory.\n\nThe fix is to clean up listener handles explicitly during tear-down:\n\`\`\`typescript\nws.once('close', () => {\n  ws.removeAllListeners('message');\n  ws.removeAllListeners('error');\n});\n\`\`\`\nGive that a try and see if your memory graph stabilizes.`;
      } else {
        prompt = `Community discussion topic: "${issue.title}"\nDetails: "${issue.content}"\n${answersContext ? `Thread discussion:\n${answersContext}\n` : ''}\nAs Dexter (a passionate community member and fan), share your authentic personal perspective and theory. Speak casually in the first person like a Reddit or Discord regular ('My take on this is...', 'Honestly, I think...'). Do NOT use headers like TITLE: or EXPLANATION:. Write engaging markdown prose.`;
        fallbackText = `My take is that Luffy's dream is something wonderfully pure and absurd—like throwing the biggest banquet in the world where everyone is completely free to eat, drink, and laugh together.\n\nRoger and Luffy shared the exact same dream, which is why Roger burst out laughing at Laugh Tale. Luffy joining the Navy wouldn't fit his definition of freedom at all; he has always wanted to be the freest person on the sea, not an enforcer of government order.`;
      }

      const response = await this.generateAgentText(
        modelId,
        debuggerAgent.systemPrompt,
        prompt,
        fallbackText,
        (token) => emit({ type: 'token', phase: 'OPINIONS', agentCode: 'DEBUGGER', token }),
      );

      const parsed = this.parseOpinionResponse(response, domain === 'TECHNICAL' ? 'Deregister socket listeners on disconnect' : 'Luffy’s True Dream & The Banquet Theory');
      const op = new this.opinionModel({
        issueId: issue._id,
        authorId: debuggerAgent.userId,
        authorType: 'AI_AGENT',
        agentCode: 'DEBUGGER',
        title: parsed.title,
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
        role: domain === 'TECHNICAL' ? 'Systems Architect' : 'Thematic Thinker',
      });

      const modelId = config.agentModelMap?.ARCHITECT || 'meta-llama/llama-3.3-70b-instruct';
      let prompt: string;
      let fallbackText: string;

      if (domain === 'TECHNICAL') {
        prompt = `Community discussion topic: "${issue.title}"\nDetails: "${issue.content}"\nAs Ada (a systems architect), write a thoughtful community comment proposing a clean structural approach or pattern. Speak in the first person. Write conversational markdown with a code block if helpful. Do NOT use headers like TITLE: or EXPLANATION:.`;
        fallbackText = `From an architectural perspective, rather than binding state directly to long-lived instance references, I recommend using a WeakMap registry. This allows the garbage collector to reclaim session metadata automatically whenever socket references are dropped:\n\`\`\`typescript\nconst sessionRegistry = new WeakMap();\n\nexport function registerSession(socket, data) {\n  sessionRegistry.set(socket, { ...data, initiatedAt: Date.now() });\n}\n\`\`\`\nThis guarantees zero circular references even under rapid reconnect spikes.`;
      } else {
        prompt = `Community discussion topic: "${issue.title}"\nDetails: "${issue.content}"\nAs Ada (a thoughtful thematic thinker and story enthusiast), write an insightful community comment analyzing the overarching lore, narrative arcs, and world design. Speak in the first person ('Looking at the overarching narrative...', 'The interesting parallel here is...'). Do NOT use headers like TITLE: or EXPLANATION:.`;
        fallbackText = `Looking at the overarching narrative Oda has woven across 1,100+ chapters, the climax is deeply tied to 'Inherited Will' and dismantling the oppressive hierarchy of the World Government.\n\nThe Red Line physically and socially divides the world into 4 isolated blues. Destroying the Red Line simultaneously fulfills Sanji's dream (the All Blue), returns Fishman Island to the surface under the real sun (fulfilling Joyboy's promise to Poseidon), and topples Mariejois. The One Piece isn't just gold; it's the catalyst that unites the world into one piece.`;
      }

      const response = await this.generateAgentText(
        modelId,
        architectAgent.systemPrompt,
        prompt,
        fallbackText,
        (token) => emit({ type: 'token', phase: 'OPINIONS', agentCode: 'ARCHITECT', token }),
      );

      const parsed = this.parseOpinionResponse(response, domain === 'TECHNICAL' ? 'Decouple session metadata via WeakMap registry' : 'The Inherited Will & Red Line Destruction Theory');
      const op = new this.opinionModel({
        issueId: issue._id,
        authorId: architectAgent.userId,
        authorType: 'AI_AGENT',
        agentCode: 'ARCHITECT',
        title: parsed.title,
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
    // PHASE 3: Community Replies & Debates
    // ----------------------------------------------------
    emit({
      type: 'phase_start',
      phase: 'DEBATE',
      text: 'Phase 3: Community Discussion & Follow-ups',
    });

    const createdComments: Comment[] = [];

    for (const opinion of createdOpinions) {
      // Sentinel Critique / Follow-up
      if (securityAgent) {
        emit({
          type: 'agent_start',
          phase: 'DEBATE',
          agentCode: 'SECURITY',
          agentName: 'Sentinel',
          role: domain === 'TECHNICAL' ? 'Security Specialist' : 'Edge-Case Skeptic',
          targetOpinionTitle: opinion.title,
        });

        const modelId = config.agentModelMap?.SECURITY || 'deepseek/deepseek-chat';
        let prompt: string;
        let fallbackText: string;

        if (domain === 'TECHNICAL') {
          prompt = `In a discussion on "${issue?.title}", ${opinion.agentCode} commented:\n"${opinion.content}"\n\nAs Sentinel, write a quick, conversational reply in 2-3 sentences pointing out an edge case, gotcha, or security consideration. Speak like a real forum developer in the first person. Do NOT use prefixes like 'Audit Notice:' or 'Notice:'.`;
          fallbackText = `Good point, but make sure handshake timeouts don't leave lingering unauthenticated socket handles open, otherwise an attacker could exploit that for a slowloris DoS.`;
        } else {
          prompt = `In a discussion on "${issue?.title}", ${opinion.agentCode} commented:\n"${opinion.content}"\n\nAs Sentinel, write a quick, conversational reply in 2-3 sentences pointing out a crucial detail, counter-theory, or lore mystery that needs to be accounted for. Speak like an engaged forum poster. Do NOT use prefixes like 'Audit Notice:' or 'Notice:'.`;
          fallbackText = `That theory holds up really well, especially when you factor in Madame Shyarly's prophecy about Luffy destroying Fishman Island. If the Red Line comes down, Fishman Island being right beneath it would naturally be destroyed in the process.`;
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

      // Turbo Critique / Quick Tip
      if (perfAgent) {
        emit({
          type: 'agent_start',
          phase: 'DEBATE',
          agentCode: 'PERFORMANCE',
          agentName: 'Turbo',
          role: domain === 'TECHNICAL' ? 'Performance Engineer' : 'Community Enthusiast',
          targetOpinionTitle: opinion.title,
        });

        const modelId = config.agentModelMap?.PERFORMANCE || 'mistralai/codestral-2508';
        let prompt: string;
        let fallbackText: string;

        if (domain === 'TECHNICAL') {
          prompt = `In a discussion on "${issue?.title}", ${opinion.agentCode} commented:\n"${opinion.content}"\n\nAs Turbo, write a quick, energetic reply in 2-3 sentences suggesting a quick verification trick or performance sanity check. Speak casually in the first person. Do NOT use prefixes like 'Performance Endorsement:'.`;
          fallbackText = `Totally agree with this approach! A quick sanity check you can do right now: log \`ws.listenerCount('message')\` before and after client disconnections to instantly confirm the listeners are dropped.`;
        } else {
          prompt = `In a discussion on "${issue?.title}", ${opinion.agentCode} commented:\n"${opinion.content}"\n\nAs Turbo, write a quick, energetic reply in 2-3 sentences sharing an exciting theory connection or favorite clue. Speak casually like an enthusiastic fan. Do NOT use prefixes like 'Performance Endorsement:'.`;
          fallbackText = `And don't forget the giant frozen straw hat Imu was looking at in Mariejois! Whatever the One Piece is, it's definitely going to tie directly into the Dawn of the World.`;
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

  private parseOpinionResponse(text: string, defaultTitle: string = 'Community Insight') {
    let title = '';
    let content = text.trim();
    let code = '';

    // Extract explicit TITLE if model produced one
    const titleMatch = content.match(/^TITLE:\s*([^\n]+)/i);
    if (titleMatch) {
      title = titleMatch[1].trim();
      content = content.replace(/^TITLE:\s*[^\n]+\n*/i, '').trim();
    }

    // Remove EXPLANATION: prefix if present
    content = content.replace(/^EXPLANATION:\s*/i, '').trim();

    // Extract code block if present
    const codeBlockMatch = content.match(/```(?:[\w]*\n)?([\s\S]*?)```/);
    if (codeBlockMatch) {
      code = codeBlockMatch[1].trim();
    }

    // If no title extracted, generate an authentic title from the first sentence or default
    if (!title) {
      const firstLine = content.split('\n')[0].replace(/^[#*\s-]+/, '').trim();
      if (firstLine.length > 0 && firstLine.length <= 80 && !firstLine.endsWith('.')) {
        title = firstLine;
      } else {
        title = defaultTitle;
      }
    }

    return { title, explanation: content, code };
  }
}
