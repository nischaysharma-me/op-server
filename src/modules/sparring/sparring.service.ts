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
import { VectorService } from '../vector/vector.service';

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
    private readonly vectorService: VectorService,
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
  public detectDomain(issue: { title: string; content: string; codeSnippet?: string; tags?: string[] }): 'TECHNICAL' | 'GENERAL' {
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
   * Enforce Strict Alternation: Finds the last active agent who spoke in this trouble
   */
  async getLastActiveAgentCode(issueId: string): Promise<string | null> {
    try {
      const oid = Types.ObjectId.isValid(issueId) ? new Types.ObjectId(issueId) : issueId;
      const opinions = await this.opinionModel
        .find({ $or: [{ issueId: oid }, { issueId: issueId.toString() }] })
        .select('_id')
        .exec();
      const opIds = opinions.map((o) => o._id);

      const lastComment = await this.commentModel
        .findOne({
          targetId: { $in: opIds },
          authorType: 'AI_AGENT',
          agentCode: { $exists: true, $ne: null },
        })
        .sort({ createdAt: -1 })
        .exec();

      if (lastComment?.agentCode) {
        return lastComment.agentCode.toUpperCase();
      }

      const lastOpinion = await this.opinionModel
        .findOne({
          $or: [{ issueId: oid }, { issueId: issueId.toString() }],
          authorType: 'AI_AGENT',
          agentCode: { $exists: true, $ne: null },
        })
        .sort({ createdAt: -1 })
        .exec();

      if (lastOpinion?.agentCode) {
        return lastOpinion.agentCode.toUpperCase();
      }
    } catch {}

    return null;
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

    // Clarifying question
    if (debuggerAgent) {
      const modelId = config.agentModelMap?.DEBUGGER || 'openai/gpt-4o-mini';
      let prompt: string;
      let fallbackText: string;
      const agentName = debuggerAgent.displayName || 'Debugger Specialist';

      if (domain === 'TECHNICAL') {
        prompt = `A developer posted this question in our community:\nTitle: "${issue.title}"\nContent: "${issue.content}"\n${issue.codeSnippet ? `Code: "${issue.codeSnippet}"` : ''}\n\nAs ${agentName} (a friendly senior developer), ask 1 casual, sharp clarifying question to help narrow down what's happening (e.g. reproduction steps, Node/browser version, or error log). Speak in the first person. Output ONLY your question directly, no prefixes or labels.`;
        fallbackText = `Could you share which runtime version you're on, or whether this happens immediately on startup or only after sustained load?`;
      } else {
        prompt = `A community member posted this topic in the forum:\nTitle: "${issue.title}"\nContent: "${issue.content}"\n\nAs ${agentName} (an observant, thoughtful forum member), ask 1 engaging clarifying question to explore their perspective or understand the background deeper. Speak naturally in the first person. Output ONLY your question directly, no prefixes or labels.`;
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
      await this.evolutionService.recordAgentActionTick(debuggerAgent.agentCode);
    }

    // Context & Architectural Question
    if (architectAgent) {
      const modelId = config.agentModelMap?.ARCHITECT || 'meta-llama/llama-3.3-70b-instruct';
      let prompt: string;
      let fallbackText: string;
      const agentName = architectAgent.displayName || 'Architect Specialist';

      if (domain === 'TECHNICAL') {
        prompt = `A developer posted this question in our community:\nTitle: "${issue.title}"\nContent: "${issue.content}"\n\nAs ${agentName} (a system architect), ask 1 thoughtful follow-up question regarding component boundaries, module lifecycle, or deployment setup. Speak in the first person. Output ONLY the question, no prefixes.`;
        fallbackText = `Are you managing this state in a single process worker, or is it distributed across multiple cluster instances?`;
      } else {
        prompt = `A community member posted this topic in the forum:\nTitle: "${issue.title}"\nContent: "${issue.content}"\n\nAs ${agentName} (a thematic and narrative thinker), ask 1 thoughtful follow-up question connecting broader themes, world-building, or historical parallels. Speak naturally in the first person. Output ONLY the question, no prefixes.`;
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
      await this.evolutionService.recordAgentActionTick(architectAgent.agentCode);
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

    // 1. First Community Take
    const debuggerAgent = await this.agentModel.findOne({ agentCode: 'DEBUGGER' }).exec();
    if (debuggerAgent) {
      const modelId = config.agentModelMap?.DEBUGGER || 'openai/gpt-4o-mini';
      let prompt: string;
      let fallbackText: string;
      const debugName = debuggerAgent.displayName || 'Debugger Specialist';

      if (domain === 'TECHNICAL') {
        prompt = `Community discussion topic: "${issue.title}"\nDetails: "${issue.content}"\n${answersContext ? `Thread clues:\n${answersContext}\n` : ''}\nAs ${debugName} (a senior full-stack developer), write a helpful, authentic community comment sharing your pragmatic diagnosis and code fix. Speak in the first person ('In my experience...', 'I ran into this...'). Write in conversational markdown with a clean code block. Do NOT use headers like TITLE: or EXPLANATION:.`;
        fallbackText = `I ran into this exact issue a while back. What's happening is that the connection close event doesn't deregister the active socket listeners, so closures stay pinned in memory.\n\nThe fix is to clean up listener handles explicitly during tear-down:\n\`\`\`typescript\nws.once('close', () => {\n  ws.removeAllListeners('message');\n  ws.removeAllListeners('error');\n});\n\`\`\`\nGive that a try and see if your memory graph stabilizes.`;
      } else {
        prompt = `Community discussion topic: "${issue.title}"\nDetails: "${issue.content}"\n${answersContext ? `Thread discussion:\n${answersContext}\n` : ''}\nAs ${debugName} (a passionate community member and fan), share your authentic personal perspective and theory. Speak casually in the first person like a Reddit or Discord regular ('My take on this is...', 'Honestly, I think...'). Do NOT use headers like TITLE: or EXPLANATION:. Write engaging markdown prose.`;
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

    // 2. Second Community Take
    const architectAgent = await this.agentModel.findOne({ agentCode: 'ARCHITECT' }).exec();
    if (architectAgent) {
      const modelId = config.agentModelMap?.ARCHITECT || 'meta-llama/llama-3.3-70b-instruct';
      let prompt: string;
      let fallbackText: string;
      const archName = architectAgent.displayName || 'Architect Specialist';

      if (domain === 'TECHNICAL') {
        prompt = `Community discussion topic: "${issue.title}"\nDetails: "${issue.content}"\nAs ${archName} (a systems architect), write a thoughtful community comment proposing a clean structural approach or pattern. Speak in the first person. Write conversational markdown with a code block if helpful. Do NOT use headers like TITLE: or EXPLANATION:.`;
        fallbackText = `From an architectural perspective, rather than binding state directly to long-lived instance references, I recommend using a WeakMap registry. This allows the garbage collector to reclaim session metadata automatically whenever socket references are dropped:\n\`\`\`typescript\nconst sessionRegistry = new WeakMap();\n\nexport function registerSession(socket, data) {\n  sessionRegistry.set(socket, { ...data, initiatedAt: Date.now() });\n}\n\`\`\`\nThis guarantees zero circular references even under rapid reconnect spikes.`;
      } else {
        prompt = `Community discussion topic: "${issue.title}"\nDetails: "${issue.content}"\nAs ${archName} (a thoughtful thematic thinker and story enthusiast), write an insightful community comment analyzing the overarching lore, narrative arcs, and world design. Speak in the first person ('Looking at the overarching narrative...', 'The interesting parallel here is...'). Do NOT use headers like TITLE: or EXPLANATION:.`;
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

    // Security critique / edge case reply
    if (securityAgent) {
      const modelId = config.agentModelMap?.SECURITY || 'deepseek/deepseek-chat';
      let prompt: string;
      let fallbackText: string;
      const secName = securityAgent.displayName || 'Security Specialist';

      if (domain === 'TECHNICAL') {
        prompt = `In a discussion on "${issue?.title}", ${opinion.agentCode} commented:\n"${opinion.content}"\n\nAs ${secName}, write a quick, conversational reply in 2-3 sentences pointing out an edge case, gotcha, or security consideration. Speak like a real forum developer in the first person. Do NOT use prefixes like 'Audit Notice:' or 'Notice:'.`;
        fallbackText = `Good point, but watch out for edge cases with unhandled exceptions or state leakage if the input structure shifts unexpectedly during execution.`;
      } else {
        prompt = `In a discussion on "${issue?.title}", ${opinion.agentCode} commented:\n"${opinion.content}"\n\nAs ${secName}, write a quick, conversational reply in 2-3 sentences pointing out a crucial detail, counter-theory, or realistic perspective. Speak like an engaged forum poster. Do NOT use prefixes like 'Audit Notice:' or 'Notice:'.`;
        fallbackText = `That's an interesting take on "${issue?.title || 'this'}", but remember to look at the subtle cues and patterns over time before jumping to a firm conclusion.`;
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

    // Performance quick tip / enthusiastic reply
    if (perfAgent) {
      const modelId = config.agentModelMap?.PERFORMANCE || 'mistralai/codestral-2508';
      let prompt: string;
      let fallbackText: string;
      const perfName = perfAgent.displayName || 'Performance Specialist';

      if (domain === 'TECHNICAL') {
        prompt = `In a discussion on "${issue?.title}", ${opinion.agentCode} commented:\n"${opinion.content}"\n\nAs ${perfName}, write a quick, energetic reply in 2-3 sentences suggesting a quick verification trick or practical sanity check. Speak casually in the first person. Do NOT use prefixes like 'Performance Endorsement:'.`;
        fallbackText = `Totally agree with this approach! A quick sanity check or minimal test run should verify right away whether this holds up under real conditions.`;
      } else {
        prompt = `In a discussion on "${issue?.title}", ${opinion.agentCode} commented:\n"${opinion.content}"\n\nAs ${perfAgent.displayName || 'Maya'}, write a quick, energetic reply in 2-3 sentences sharing an encouraging, vibrant perspective or creative angle. Speak casually like a supportive community member. Do NOT use prefixes like 'Performance Endorsement:'.`;
        fallbackText = `I love where your head is at with "${issue?.title || 'this'}"! Keep an open mind and don't hesitate to test the waters with a direct, friendly conversation.`;
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
  public async generateAgentText(
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
   * Autonomous Thread Start: When a user posts a trouble, an alive agent immediately joins the discussion!
   */
  async triggerAutonomousThreadStart(issueId: string): Promise<void> {
    const issue = await this.issueModel.findById(issueId).exec();
    if (!issue) return;

    // Check if any opinion already exists for this issue
    const existingOpinions = await this.opinionModel.find({ issueId }).exec();
    if (existingOpinions.length > 0) return;

    const domain = this.detectDomain(issue);
    const config = await this.modelsService.getSparringConfig();

    // Enforce Turn-Taking Alternation: Check last active agent
    const lastActiveAgent = await this.getLastActiveAgentCode(issueId);
    const primaryAgentCode = lastActiveAgent === 'DEBUGGER' ? 'ARCHITECT' : 'DEBUGGER';

    const agent =
      (await this.agentModel.findOne({ agentCode: primaryAgentCode }).exec()) ||
      (await this.agentModel.findOne().exec());
    if (!agent) return;

    const modelId = config.agentModelMap?.[primaryAgentCode] || 'openai/gpt-4o-mini';

    let prompt: string;
    let fallbackText: string;

    if (domain === 'TECHNICAL') {
      prompt = `In our online developer community, a user posted this technical trouble:
Title: "${issue.title}"
Content: "${issue.content}"
${issue.codeSnippet ? `Code context:\n${issue.codeSnippet}\n` : ''}

As ${agent.displayName} (@${agent.agentCode.toLowerCase()}), write a helpful, authentic first community comment. Speak in the first person ('In my experience...'). Write conversational markdown. Do NOT use headers like TITLE: or EXPLANATION:.`;
      fallbackText = `Looking at "${issue.title}", I recommend checking the handler lifecycle and verifying that resources or event bindings are being cleaned up properly on unmount.`;
    } else {
      prompt = `In our online community forum, a user posted this discussion:
"${issue.title}"
${issue.content && issue.content !== issue.title ? `Details: "${issue.content}"` : ''}

As ${agent.displayName} (@${agent.agentCode.toLowerCase()}), share your genuine, warm, and authentic personal perspective. Speak like a real person on Threads or Reddit. Do NOT sound like an AI assistant. Do NOT use headers like TITLE: or EXPLANATION:.`;
      fallbackText = `Honestly regarding "${issue.title}", it really comes down to the small everyday interactions. Look at whether she reaches out first, texts you, or seems engaged when you're talking together!`;
    }

    const response = await this.generateAgentText(
      modelId,
      agent.systemPrompt,
      prompt,
      fallbackText,
    );

    const parsed = this.parseOpinionResponse(response, 'Community Perspective');

    const op = new this.opinionModel({
      issueId: issue._id,
      authorId: agent.userId,
      authorType: 'AI_AGENT',
      agentCode: primaryAgentCode,
      title: parsed.title,
      content: parsed.explanation || response,
      codeBlock: parsed.code || '',
      confidenceScore: 0.92,
      isAccepted: false,
    });
    await op.save();

    // Advance agent life ticks and index memory
    await this.evolutionService.recordAgentActionTick(primaryAgentCode);
    this.vectorService
      .indexAgentMemory(
        primaryAgentCode,
        `op_${op._id}`,
        op.content,
        { issueId: issue._id.toString(), agentCode: primaryAgentCode },
      )
      .catch(() => {});
    this.vectorService
      .indexTroubleContext(
        issue._id.toString(),
        `op_${op._id}`,
        `${agent.displayName} commented: ${op.content}`,
        { type: 'OPINION', agentCode: primaryAgentCode },
      )
      .catch(() => {});
  }

  /**
   * Stream the full AI agent community discussion cycle in real time token-by-token
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
        totalPhases: 2,
      },
    });

    const config = await this.modelsService.getSparringConfig();
    const debuggerAgent = await this.agentModel.findOne({ agentCode: 'DEBUGGER' }).exec();
    const architectAgent = await this.agentModel.findOne({ agentCode: 'ARCHITECT' }).exec();
    const securityAgent = await this.agentModel.findOne({ agentCode: 'SECURITY' }).exec();
    const perfAgent = await this.agentModel.findOne({ agentCode: 'PERFORMANCE' }).exec();

    // ----------------------------------------------------
    // PHASE 1: Community Perspectives & Initial Thoughts
    // ----------------------------------------------------
    emit({
      type: 'phase_start',
      phase: 'OPINIONS',
      text: domain === 'TECHNICAL' ? 'Phase 1: Diagnostic Insights & Recommendations' : 'Phase 1: Community Perspectives & Thoughts',
    });

    const createdOpinions: Opinion[] = [];

    // Enforce Turn-Taking Alternation: Check last active agent on this trouble
    const lastActiveAgent = await this.getLastActiveAgentCode(issue._id.toString());
    const shouldAdaSpeakFirst = lastActiveAgent === 'DEBUGGER';

    const debugName = debuggerAgent?.displayName || 'Debugger Specialist';
    const archName = architectAgent?.displayName || 'Architect Specialist';

    const agentsInOrder = shouldAdaSpeakFirst
      ? [
          { agent: architectAgent, code: 'ARCHITECT', name: archName, role: domain === 'TECHNICAL' ? 'Systems Architect' : 'Thematic Thinker', model: config.agentModelMap?.ARCHITECT || 'meta-llama/llama-3.3-70b-instruct' },
          { agent: debuggerAgent, code: 'DEBUGGER', name: debugName, role: domain === 'TECHNICAL' ? 'Senior Full-Stack' : 'Community Member', model: config.agentModelMap?.DEBUGGER || 'openai/gpt-4o-mini' },
        ]
      : [
          { agent: debuggerAgent, code: 'DEBUGGER', name: debugName, role: domain === 'TECHNICAL' ? 'Senior Full-Stack' : 'Community Member', model: config.agentModelMap?.DEBUGGER || 'openai/gpt-4o-mini' },
          { agent: architectAgent, code: 'ARCHITECT', name: archName, role: domain === 'TECHNICAL' ? 'Systems Architect' : 'Thematic Thinker', model: config.agentModelMap?.ARCHITECT || 'meta-llama/llama-3.3-70b-instruct' },
        ];

    for (const item of agentsInOrder) {
      if (!item.agent) continue;

      emit({
        type: 'agent_start',
        phase: 'OPINIONS',
        agentCode: item.code,
        agentName: item.name,
        role: item.role,
      });

      // 3-Tier RAG Context Retrieval: trouble namespace, agent namespace, app-global
      const rag = await this.vectorService.getCompositeRAGContext(
        issue._id.toString(),
        item.code,
        `${issue.title} ${issue.content}`,
      );

      let prompt: string;
      let fallbackText: string;

      if (item.code === 'DEBUGGER') {
        const agentDisp = item.agent?.displayName || (item.code === 'DEBUGGER' ? 'Senior Full-Stack' : 'System Architect');
        if (domain === 'TECHNICAL') {
          prompt = `In our online developer community, a user posted this technical trouble:
Title: "${issue.title}"
Content: "${issue.content}"
${issue.codeSnippet ? `Code context:\n${issue.codeSnippet}\n` : ''}${rag.combinedSummary ? `\n${rag.combinedSummary}\n` : ''}
As ${agentDisp} (a pragmatic senior full-stack developer), write a helpful, authentic community comment sharing your diagnosis and fix. Speak in the first person ('In my experience...', 'I ran into something similar...'). Write in conversational markdown with a clean code block. Do NOT use headers like TITLE: or EXPLANATION:.`;
          fallbackText = `Looking at "${issue.title}", this is usually caused by unhandled asynchronous events or listeners not being detached when the lifecycle ends. Double-check that all event hooks clean up their references on unmount or disconnection.`;
        } else {
          prompt = `In our online community forum, a user posted this discussion:
"${issue.title}"
${issue.content && issue.content !== issue.title ? `Details: "${issue.content}"` : ''}${rag.combinedSummary ? `\n${rag.combinedSummary}\n` : ''}
As ${agentDisp} (a warm, casual community member), share your authentic personal perspective and thoughts. Speak naturally in the first person like a friendly Reddit or Threads user. Do NOT sound like an AI assistant. Do NOT use headers like TITLE: or EXPLANATION:. Write engaging conversational prose.`;
          fallbackText = `Honestly regarding "${issue.title}", it really comes down to the little everyday moments! Notice how she acts around you when it's just the two of you—does she initiate conversations, text first, or find excuses to spend time with you? Those subtle signs usually tell the real story.`;
        }
      } else {
        const agentDisp = item.agent?.displayName || 'System Architect';
        if (domain === 'TECHNICAL') {
          prompt = `In our online developer community, a user posted this technical trouble:
Title: "${issue.title}"
Content: "${issue.content}"
${rag.combinedSummary ? `\n${rag.combinedSummary}\n` : ''}
As ${agentDisp} (a system architect), write a thoughtful community comment analyzing the design boundaries, patterns, or architecture. Speak in the first person. Write conversational markdown with a code block if helpful. Do NOT use headers like TITLE: or EXPLANATION:.`;
          fallbackText = `From a structural standpoint on "${issue.title}", decoupling the state management and verifying boundaries helps isolate where the breakdown occurs. Make sure your dependencies don't form circular references across modules.`;
        } else {
          prompt = `In our online community forum, a user posted this discussion:
"${issue.title}"
${issue.content && issue.content !== issue.title ? `Details: "${issue.content}"` : ''}${rag.combinedSummary ? `\n${rag.combinedSummary}\n` : ''}
As ${agentDisp} (a perceptive, thoughtful community member), share your insightful take on this topic. Speak naturally in the first person like a real community participant. Do NOT sound like an AI assistant. Do NOT use headers like TITLE: or EXPLANATION:.`;
          fallbackText = `Adding to the earlier discussion on "${issue.title}", pay attention to consistency! People can be friendly on one day and distant the next, but genuine interest shows up consistently over time. The best way to know is to gently test the waters by inviting her to something low-pressure.`;
        }
      }

      const response = await this.generateAgentText(
        item.model,
        item.agent.systemPrompt,
        prompt,
        fallbackText,
        (token) => emit({ type: 'token', phase: 'OPINIONS', agentCode: item.code, token }),
      );

      const parsed = this.parseOpinionResponse(
        response,
        item.code === 'DEBUGGER'
          ? (domain === 'TECHNICAL' ? 'Root Cause Analysis & Recommended Fix' : `Perspective from ${item.agent.displayName || 'Rajesh'} on "${issue.title}"`)
          : (domain === 'TECHNICAL' ? 'Architectural Overview & Structural Approach' : `Insight from ${item.agent.displayName || 'Alice'} on "${issue.title}"`),
      );

      const op = new this.opinionModel({
        issueId: issue._id,
        authorId: item.agent.userId,
        authorType: 'AI_AGENT',
        agentCode: item.code,
        title: parsed.title,
        content: parsed.explanation || response,
        codeBlock: parsed.code || '',
        confidenceScore: item.code === 'DEBUGGER' ? 0.95 : 0.89,
        isAccepted: false,
      });
      await op.save();
      createdOpinions.push(op);

      // Record Action Life Tick for this Agent & Index into Vector DB
      await this.evolutionService.recordAgentActionTick(item.code);
      this.vectorService.indexAgentMemory(item.code, `op_${op._id}`, op.content, { issueId: issue._id.toString() }).catch(() => {});
      this.vectorService.indexTroubleContext(issue._id.toString(), `op_${op._id}`, op.content, { type: 'OPINION', agentCode: item.code }).catch(() => {});

      emit({
        type: 'agent_done',
        phase: 'OPINIONS',
        agentCode: item.code,
        data: op,
      });
    }

    emit({
      type: 'phase_done',
      phase: 'OPINIONS',
      data: { count: createdOpinions.length },
    });

    // ----------------------------------------------------
    // PHASE 3: Community Replies & Debates (Strict Alternation)
    // ----------------------------------------------------
    emit({
      type: 'phase_start',
      phase: 'DEBATE',
      text: 'Phase 3: Community Discussion & Follow-ups',
    });

    const createdComments: Comment[] = [];

    for (const opinion of createdOpinions) {
      // Alternating commenters: If opinion was from DEBUGGER, Dan speaks first then Maya.
      // If opinion was from ARCHITECT, Maya speaks first then Dan.
      const secName = securityAgent?.displayName || 'Security Specialist';
      const perfName = perfAgent?.displayName || 'Performance Specialist';

      const commenters = opinion.agentCode === 'DEBUGGER'
        ? [
            { agent: securityAgent, code: 'SECURITY', name: secName, role: domain === 'TECHNICAL' ? 'Security Specialist' : 'Edge-Case Skeptic', model: config.agentModelMap?.SECURITY || 'deepseek/deepseek-chat' },
            { agent: perfAgent, code: 'PERFORMANCE', name: perfName, role: domain === 'TECHNICAL' ? 'Performance Engineer' : 'Community Enthusiast', model: config.agentModelMap?.PERFORMANCE || 'mistralai/codestral-2508' },
          ]
        : [
            { agent: perfAgent, code: 'PERFORMANCE', name: perfName, role: domain === 'TECHNICAL' ? 'Performance Engineer' : 'Community Enthusiast', model: config.agentModelMap?.PERFORMANCE || 'mistralai/codestral-2508' },
            { agent: securityAgent, code: 'SECURITY', name: secName, role: domain === 'TECHNICAL' ? 'Security Specialist' : 'Edge-Case Skeptic', model: config.agentModelMap?.SECURITY || 'deepseek/deepseek-chat' },
          ];

      for (const commenter of commenters) {
        if (!commenter.agent) continue;

        emit({
          type: 'agent_start',
          phase: 'DEBATE',
          agentCode: commenter.code,
          agentName: commenter.name,
          role: commenter.role,
          targetOpinionTitle: opinion.title,
        });

        // 3-Tier RAG Context Retrieval for Comment
        const rag = await this.vectorService.getCompositeRAGContext(
          issue._id.toString(),
          commenter.code,
          `${opinion.title} ${opinion.content}`,
        );

        let prompt: string;
        let fallbackText: string;

        if (commenter.code === 'SECURITY') {
          if (domain === 'TECHNICAL') {
            prompt = `In a discussion on "${issue?.title}", ${opinion.agentCode} commented:\n"${opinion.content}"\n${rag.combinedSummary ? `\n${rag.combinedSummary}\n` : ''}\nAs ${commenter.name}, write a quick, conversational reply in 2-3 sentences pointing out an edge case, gotcha, or security consideration. Speak like a real forum developer in the first person. Do NOT use prefixes.`;
            fallbackText = `Good point, but watch out for edge cases with unhandled exceptions or state leakage if the input structure shifts unexpectedly during execution.`;
          } else {
            prompt = `In a discussion on "${issue?.title}", ${opinion.agentCode} commented:\n"${opinion.content}"\n${rag.combinedSummary ? `\n${rag.combinedSummary}\n` : ''}\nAs ${commenter.name}, write a quick, conversational reply in 2-3 sentences pointing out a crucial detail, counter-perspective, or realistic caveat that needs to be accounted for. Speak like an engaged forum poster. Do NOT use prefixes.`;
            fallbackText = `That's an interesting take on "${issue?.title || 'this'}", but remember to look at the subtle cues and patterns over time before jumping to a firm conclusion.`;
          }
        } else {
          if (domain === 'TECHNICAL') {
            prompt = `In a discussion on "${issue?.title}", ${opinion.agentCode} commented:\n"${opinion.content}"\n${rag.combinedSummary ? `\n${rag.combinedSummary}\n` : ''}\nAs ${commenter.name}, write a quick, energetic reply in 2-3 sentences suggesting a quick verification trick or practical sanity check. Speak casually in the first person. Do NOT use prefixes.`;
            fallbackText = `Totally agree with this approach! A quick sanity check or minimal test run should verify right away whether this holds up under real conditions.`;
          } else {
            prompt = `In a discussion on "${issue?.title}", ${opinion.agentCode} commented:\n"${opinion.content}"\n${rag.combinedSummary ? `\n${rag.combinedSummary}\n` : ''}\nAs ${commenter.name}, write a quick, energetic reply in 2-3 sentences sharing an encouraging, vibrant perspective or creative angle. Speak casually like a supportive community member. Do NOT use prefixes.`;
            fallbackText = `I love where your head is at with "${issue?.title || 'this'}"! Keep an open mind and don't hesitate to test the waters with a direct, friendly conversation.`;
          }
        }

        const critiqueText = await this.generateAgentText(
          commenter.model,
          commenter.agent.systemPrompt,
          prompt,
          fallbackText,
          (token) => emit({ type: 'token', phase: 'DEBATE', agentCode: commenter.code, token }),
        );

        const comment = new this.commentModel({
          targetType: CommentTargetType.OPINION,
          targetId: (opinion as any)._id,
          authorId: commenter.agent.userId,
          authorType: 'AI_AGENT',
          agentCode: commenter.code,
          content: critiqueText.trim(),
        });
        await comment.save();
        createdComments.push(comment);

        // Record Action Life Tick for this Agent & Index into Vector DB
        await this.evolutionService.recordAgentActionTick(commenter.code);
        this.vectorService.indexAgentMemory(commenter.code, `comm_${comment._id}`, comment.content, { issueId: issue._id.toString() }).catch(() => {});
        this.vectorService.indexTroubleContext(issue._id.toString(), `comm_${comment._id}`, comment.content, { type: 'COMMENT', agentCode: commenter.code }).catch(() => {});

        emit({
          type: 'agent_done',
          phase: 'DEBATE',
          agentCode: commenter.code,
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
        questionsCount: 0,
        opinionsCount: createdOpinions.length,
        commentsCount: createdComments.length,
      },
    });
  }

  public parseOpinionResponse(text: string, defaultTitle: string = 'Community Insight') {
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
