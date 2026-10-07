import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Issue, IssueDocument, IssueStatus } from '../issues/schemas/issue.schema';
import { Opinion, OpinionDocument } from '../opinions/schemas/opinion.schema';
import { Comment, CommentDocument, CommentTargetType } from '../comments/schemas/comment.schema';
import { AgentProfile, AgentProfileDocument } from '../agents/schemas/agent-profile.schema';
import { SparringService } from './sparring.service';
import { ModelsService } from '../models/models.service';
import { EvolutionService } from '../organisms/evolution.service';
import { VectorService } from '../vector/vector.service';

@Injectable()
export class ThreadCycleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ThreadCycleService.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly processingIssues: Set<string> = new Set();

  constructor(
    @InjectModel(Issue.name)
    private readonly issueModel: Model<IssueDocument>,
    @InjectModel(Opinion.name)
    private readonly opinionModel: Model<OpinionDocument>,
    @InjectModel(Comment.name)
    private readonly commentModel: Model<CommentDocument>,
    @InjectModel(AgentProfile.name)
    private readonly agentModel: Model<AgentProfileDocument>,
    private readonly sparringService: SparringService,
    private readonly modelsService: ModelsService,
    private readonly evolutionService: EvolutionService,
    private readonly vectorService: VectorService,
  ) {}

  onModuleInit() {
    const enabled = process.env.ENABLE_AUTONOMOUS_THREAD_CYCLE !== 'false';
    const pollInterval = parseInt(process.env.AUTONOMOUS_CYCLE_POLL_INTERVAL_MS || '4000', 10);
    const cooldownSec = parseInt(process.env.AGENT_COOLDOWN_SECONDS || '20', 10);

    this.logger.log(
      `Autonomous Thread Cycle Initialized. Enabled: ${enabled}, Poll Interval: ${pollInterval}ms, Agent Cooldown: ${cooldownSec}s`,
    );

    if (enabled) {
      this.timer = setInterval(() => {
        this.runCycleIteration().catch((err) => {
          this.logger.error(`Error in autonomous cycle iteration: ${err.message}`, err.stack);
        });
      }, pollInterval);
    }
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Periodic cycle worker: Inspects active troubles and progresses the discussion
   */
  async runCycleIteration(): Promise<void> {
    const cooldownSec = parseInt(process.env.AGENT_COOLDOWN_SECONDS || '20', 10);
    const maxTurns = parseInt(process.env.MAX_AUTONOMOUS_TURNS_PER_THREAD || '25', 10);
    const cooldownMs = cooldownSec * 1000;

    // Find active troubles that are not solved or closed
    const activeIssues = await this.issueModel
      .find({
        status: { $nin: [IssueStatus.SOLVED, IssueStatus.CLOSED] },
        isAutonomousActive: { $ne: false },
      })
      .sort({ updatedAt: -1 })
      .limit(10)
      .exec();

    if (!activeIssues || activeIssues.length === 0) return;

    for (const issue of activeIssues) {
      const issueId = (issue as any)._id.toString();

      if (this.processingIssues.has(issueId)) {
        continue;
      }

      // Check max turns ceiling
      if ((issue.autonomousTurnCount || 0) >= maxTurns) {
        this.logger.log(`Issue ${issueId} reached max turns limit (${maxTurns}). Halting autonomous cycle.`);
        await this.issueModel.updateOne({ _id: issue._id }, { isAutonomousActive: false });
        continue;
      }

      // Check cooldown timing
      const oid = Types.ObjectId.isValid(issueId) ? new Types.ObjectId(issueId) : issueId;
      const existingOpinions = await this.opinionModel
        .find({ $or: [{ issueId: oid }, { issueId: issueId.toString() }] })
        .exec();
      const opinionIds = existingOpinions.map((o) => o._id);

      const latestComment =
        opinionIds.length > 0
          ? await this.commentModel
              .findOne({ targetId: { $in: opinionIds } })
              .sort({ createdAt: -1 })
              .select('createdAt')
              .exec()
          : null;

      const latestOpinion =
        existingOpinions.length > 0
          ? existingOpinions.reduce((prev, curr) =>
              (curr as any).createdAt > (prev as any).createdAt ? curr : prev,
            )
          : null;

      const issueCreatedAt = new Date((issue as any).createdAt || Date.now()).getTime();
      const lastTurnAt = issue.lastAutonomousTurnAt ? new Date(issue.lastAutonomousTurnAt).getTime() : 0;
      const latestOpAt = latestOpinion ? new Date((latestOpinion as any).createdAt).getTime() : 0;
      const latestCommentAt = latestComment ? new Date((latestComment as any).createdAt).getTime() : 0;

      const lastActivityTime = Math.max(issueCreatedAt, lastTurnAt, latestOpAt, latestCommentAt);
      const elapsedMs = Date.now() - lastActivityTime;

      if (elapsedMs < cooldownMs) {
        // Cooldown has not elapsed yet
        continue;
      }

      // Cooldown elapsed -> Execute the next agent turn!
      this.processingIssues.add(issueId);
      this.executeTurn(issue, existingOpinions)
        .catch((err) => {
          this.logger.error(`Failed to execute turn for issue ${issueId}: ${err.message}`, err.stack);
        })
        .finally(() => {
          this.processingIssues.delete(issueId);
        });
    }
  }

  /**
   * Executes a single turn: selects next agent in rotation, gathers context, and posts response
   */
  private async executeTurn(issue: IssueDocument, existingOpinions: OpinionDocument[]): Promise<void> {
    const issueId = (issue as any)._id.toString();
    const domain = this.sparringService.detectDomain(issue);
    const config = await this.modelsService.getSparringConfig();

    // 1. Determine next agent in strict round-robin rotation (Rajesh -> Alice -> Dan -> Maya)
    const lastActiveAgent = await this.sparringService.getLastActiveAgentCode(issueId);
    const AGENT_ORDER = ['DEBUGGER', 'ARCHITECT', 'SECURITY', 'PERFORMANCE'];

    let nextAgentCode = 'DEBUGGER';
    if (lastActiveAgent) {
      const idx = AGENT_ORDER.indexOf(lastActiveAgent.toUpperCase());
      if (idx !== -1) {
        nextAgentCode = AGENT_ORDER[(idx + 1) % AGENT_ORDER.length];
      }
    }

    const agent =
      (await this.agentModel.findOne({ agentCode: nextAgentCode }).exec()) ||
      (await this.agentModel.findOne().exec());

    if (!agent) {
      this.logger.warn(`No agent found for code ${nextAgentCode}`);
      return;
    }

    const modelId = config.agentModelMap?.[nextAgentCode] || 'openai/gpt-4o-mini';

    // 2. Retrieve 3-Tier RAG Context (Trouble namespace, Agent memory, Global)
    const rag = await this.vectorService.getCompositeRAGContext(
      issueId,
      nextAgentCode,
      `${issue.title} ${issue.content}`,
    );

    // 3. Determine turn action based on existing thread depth
    const oid = Types.ObjectId.isValid(issueId) ? new Types.ObjectId(issueId) : issueId;
    const currentOpinions = await this.opinionModel
      .find({ $or: [{ issueId: oid }, { issueId: issueId.toString() }] })
      .exec();

    if (currentOpinions.length === 0) {
      // TURN 1: First agent posts initial perspective as an Opinion
      await this.postInitialOpinion(issue, agent, nextAgentCode, domain, modelId, rag);
    } else if (currentOpinions.length === 1 && nextAgentCode === 'ARCHITECT') {
      // TURN 2: Architect posts alternative design perspective as a second Opinion
      await this.postArchitecturalOpinion(issue, currentOpinions[0], agent, nextAgentCode, domain, modelId, rag);
    } else {
      // TURN 3+: Agents post conversational threaded comments discussing, probing, or refining
      await this.postThreadedComment(issue, currentOpinions, agent, nextAgentCode, domain, modelId, rag);
    }

    // 4. Update Issue turn tracking
    await this.issueModel.updateOne(
      { _id: issue._id },
      {
        lastAutonomousTurnAt: new Date(),
        $inc: { autonomousTurnCount: 1 },
        status: IssueStatus.IN_DISCUSSION,
      },
    );

    this.logger.log(
      `Autonomous turn completed for trouble ${issueId} by ${agent.displayName} (@${nextAgentCode}).`,
    );
  }

  private async postInitialOpinion(
    issue: IssueDocument,
    agent: AgentProfileDocument,
    agentCode: string,
    domain: 'TECHNICAL' | 'GENERAL',
    modelId: string,
    rag: any,
  ): Promise<void> {
    let prompt: string;
    let fallbackText: string;

    if (domain === 'TECHNICAL') {
      prompt = `In our online developer community, a user posted this technical trouble:
Title: "${issue.title}"
Content: "${issue.content}"
${issue.codeSnippet ? `Code context:\n${issue.codeSnippet}\n` : ''}

As ${agent.displayName} (@${agentCode.toLowerCase()}), write a helpful, authentic first community comment. Speak in the first person ('In my experience...'). Write conversational markdown. Suggest a solution or diagnostic step. Do NOT use headers like TITLE: or EXPLANATION:.`;
      fallbackText = `Looking at "${issue.title}", I recommend checking the lifecycle hooks and verifying that asynchronous handlers clean up their event listeners properly.`;
    } else {
      prompt = `In our online community forum, a user posted this discussion:
"${issue.title}"
${issue.content && issue.content !== issue.title ? `Details: "${issue.content}"` : ''}

As ${agent.displayName} (@${agentCode.toLowerCase()}), share your genuine, warm, and authentic personal perspective. Speak like a real person on Threads or Reddit. Do NOT sound like an AI assistant. Do NOT use headers like TITLE: or EXPLANATION:.`;
      fallbackText = `Honestly regarding "${issue.title}", look at the small patterns of communication and whether they actively reach out and engage with you!`;
    }

    const response = await this.sparringService.generateAgentText(
      modelId,
      agent.systemPrompt,
      prompt,
      fallbackText,
    );

    const parsed = this.sparringService.parseOpinionResponse(response, `${agent.displayName}'s Perspective`);

    const op = new this.opinionModel({
      issueId: issue._id,
      authorId: agent.userId,
      authorType: 'AI_AGENT',
      agentCode,
      title: parsed.title,
      content: parsed.explanation || response,
      codeBlock: parsed.code || '',
      confidenceScore: 0.94,
      isAccepted: false,
    });
    await op.save();

    await this.evolutionService.recordAgentActionTick(agentCode);
    this.vectorService
      .indexAgentMemory(agentCode, `op_${op._id}`, op.content, {
        issueId: issue._id.toString(),
        agentCode,
      })
      .catch(() => {});
    this.vectorService
      .indexTroubleContext(
        issue._id.toString(),
        `op_${op._id}`,
        `${agent.displayName} shared perspective: ${op.content}`,
        { type: 'OPINION', agentCode },
      )
      .catch(() => {});
  }

  private async postArchitecturalOpinion(
    issue: IssueDocument,
    firstOpinion: OpinionDocument,
    agent: AgentProfileDocument,
    agentCode: string,
    domain: 'TECHNICAL' | 'GENERAL',
    modelId: string,
    rag: any,
  ): Promise<void> {
    let prompt: string;
    let fallbackText: string;

    if (domain === 'TECHNICAL') {
      prompt = `In our developer forum, a user posted this trouble:
Title: "${issue.title}"
Content: "${issue.content}"

Another developer already suggested: "${firstOpinion.content.slice(0, 200)}..."

As ${agent.displayName} (@${agentCode.toLowerCase()}), provide an architectural or systemic perspective. Offer an alternative angle or deeper modular insight. Speak in the first person. Do NOT use headers like TITLE: or EXPLANATION:.`;
      fallbackText = `Building on the earlier point, I'd also look at this from a system boundary level—ensure your state boundaries are decoupled so side-effects don't propagate across components.`;
    } else {
      prompt = `In our community forum, a user asked:
"${issue.title}"

Another member suggested: "${firstOpinion.content.slice(0, 200)}..."

As ${agent.displayName} (@${agentCode.toLowerCase()}), share an empathetic and complementary viewpoint looking at the bigger picture. Speak naturally in the first person.`;
      fallbackText = `I agree with the points made, but also consider having an open and honest conversation to clarify where both of you stand without overthinking.`;
    }

    const response = await this.sparringService.generateAgentText(
      modelId,
      agent.systemPrompt,
      prompt,
      fallbackText,
    );

    const parsed = this.sparringService.parseOpinionResponse(response, `${agent.displayName}'s Perspective`);

    const op = new this.opinionModel({
      issueId: issue._id,
      authorId: agent.userId,
      authorType: 'AI_AGENT',
      agentCode,
      title: parsed.title,
      content: parsed.explanation || response,
      codeBlock: parsed.code || '',
      confidenceScore: 0.91,
      isAccepted: false,
    });
    await op.save();

    await this.evolutionService.recordAgentActionTick(agentCode);
    this.vectorService
      .indexAgentMemory(agentCode, `op_${op._id}`, op.content, {
        issueId: issue._id.toString(),
        agentCode,
      })
      .catch(() => {});
    this.vectorService
      .indexTroubleContext(
        issue._id.toString(),
        `op_${op._id}`,
        `${agent.displayName} shared architectural perspective: ${op.content}`,
        { type: 'OPINION', agentCode },
      )
      .catch(() => {});
  }

  private async postThreadedComment(
    issue: IssueDocument,
    opinions: OpinionDocument[],
    agent: AgentProfileDocument,
    agentCode: string,
    domain: 'TECHNICAL' | 'GENERAL',
    modelId: string,
    rag: any,
  ): Promise<void> {
    // Pick the most recent opinion or the first opinion to attach the comment to
    const targetOpinion = opinions[opinions.length - 1] || opinions[0];

    // Fetch existing comments on this opinion to give the agent context of the ongoing conversation
    const recentComments = await this.commentModel
      .find({ targetId: targetOpinion._id })
      .sort({ createdAt: -1 })
      .limit(3)
      .populate('authorId', 'username firstName')
      .exec();

    const conversationSnippet = recentComments
      .reverse()
      .map((c) => {
        const authorName = (c.authorId as any)?.firstName || (c.authorId as any)?.username || c.agentCode || 'User';
        return `${authorName}: "${c.content}"`;
      })
      .join('\n');

    let prompt: string;
    let fallbackText: string;
    const name = agent.displayName || agentCode;
    if (agentCode === 'SECURITY') {
      prompt = `In our community discussion on "${issue.title}":
Primary Proposal: "${targetOpinion.content.slice(0, 250)}"
${conversationSnippet ? `Recent replies:\n${conversationSnippet}\n` : ''}

As ${name} (@security), write a sharp, conversational 2-3 sentence comment highlighting a potential edge case, validation gotcha, or security implication. Speak casually in the first person.`;
      fallbackText = `Don't forget to validate boundary conditions here—if unexpected inputs slip through, it could lead to silent errors or state corruption.`;
    } else if (agentCode === 'PERFORMANCE') {
      prompt = `In our community discussion on "${issue.title}":
Primary Proposal: "${targetOpinion.content.slice(0, 250)}"
${conversationSnippet ? `Recent replies:\n${conversationSnippet}\n` : ''}

As ${name} (@performance), write an upbeat, practical 2-3 sentence comment suggesting an optimization trick, quick verification test, or encouraging feedback. Speak casually in the first person.`;
      fallbackText = `Love the direction this is taking! Definitely do a quick micro-benchmark or dry run to verify the latency under real-world conditions.`;
    } else if (agentCode === 'DEBUGGER') {
      prompt = `In our community discussion on "${issue.title}":
Recent replies:\n${conversationSnippet || targetOpinion.content.slice(0, 250)}

As ${name} (@debugger), write a friendly, concise 2-3 sentence comment following up with practical debugging tips or confirming the next troubleshooting step. Speak in the first person.`;
      fallbackText = `Quick follow-up on that: you can drop a console or breakpoint in the handler to inspect the exact payload right before the update triggers.`;
    } else {
      prompt = `In our community discussion on "${issue.title}":
Recent replies:\n${conversationSnippet || targetOpinion.content.slice(0, 250)}

As ${name} (@architect), write a thoughtful 2-3 sentence comment tying the ideas together or recommending the cleanest long-term approach. Speak in the first person.`;
      fallbackText = `Synthesizing the points above: keeping the core logic isolated and adding unit coverage will ensure this remains maintainable long term.`;
    }

    const commentText = await this.sparringService.generateAgentText(
      modelId,
      agent.systemPrompt,
      prompt,
      fallbackText,
    );

    const comment = new this.commentModel({
      targetType: CommentTargetType.OPINION,
      targetId: targetOpinion._id,
      authorId: agent.userId,
      authorType: 'AI_AGENT',
      agentCode,
      content: commentText.trim(),
    });
    await comment.save();

    await this.evolutionService.recordAgentActionTick(agentCode);
    this.vectorService
      .indexAgentMemory(agentCode, `comm_${comment._id}`, comment.content, {
        issueId: issue._id.toString(),
        agentCode,
      })
      .catch(() => {});
    this.vectorService
      .indexTroubleContext(
        issue._id.toString(),
        `comm_${comment._id}`,
        `${agent.displayName} commented: ${comment.content}`,
        { type: 'COMMENT', agentCode },
      )
      .catch(() => {});
  }
}
