import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Message, MessageDocument } from './schemas/message.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { AgentProfile, AgentProfileDocument } from '../agents/schemas/agent-profile.schema';
import { SendMessageDto } from './dto/send-message.dto';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    @InjectModel(Message.name)
    private readonly messageModel: Model<MessageDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(AgentProfile.name)
    private readonly agentModel: Model<AgentProfileDocument>,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Helper to compute a consistent conversation ID between two participants
   */
  getConversationId(id1: string, id2: string): string {
    const sorted = [id1, id2].sort();
    return `conv_${sorted[0]}_${sorted[1]}`;
  }

  /**
   * Get all active conversations for a user
   */
  async getConversations(userId: string) {
    const messages = await this.messageModel
      .find({
        $or: [{ senderId: userId }, { recipientId: userId }],
      })
      .sort({ createdAt: -1 })
      .exec();

    const convMap = new Map<string, any>();

    for (const msg of messages) {
      if (!convMap.has(msg.conversationId)) {
        const isUserSender = msg.senderId === userId;
        const partnerId = isUserSender ? msg.recipientId : msg.senderId;
        const partnerType = isUserSender ? msg.recipientType : msg.senderType;
        const partnerName = isUserSender ? msg.recipientName : msg.senderName;
        const partnerAvatar = isUserSender ? msg.recipientAvatar : msg.senderAvatar;

        convMap.set(msg.conversationId, {
          conversationId: msg.conversationId,
          partnerId,
          partnerType,
          partnerName: partnerName || partnerId,
          partnerAvatar: partnerAvatar || '',
          lastMessage: msg.content,
          lastMessageAt: (msg as any).createdAt,
          isLastMessageMine: isUserSender,
          unreadCount: !isUserSender && !msg.isRead ? 1 : 0,
        });
      } else if (msg.recipientId === userId && !msg.isRead) {
        const current = convMap.get(msg.conversationId);
        current.unreadCount += 1;
      }
    }

    // If user has no conversations yet, return initial suggested AI agent conversations
    if (convMap.size === 0) {
      const defaultAgents = [
        {
          code: 'DEBUGGER',
          name: 'Dexter (Debugger)',
          avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=Dexter',
          greeting: 'Hello! I am Dexter. If you are investigating a tricky bug, performance issue, or mystery, send me a message anytime!',
        },
        {
          code: 'ARCHITECT',
          name: 'Ada (Architect)',
          avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=Ada',
          greeting: 'Greetings! I am Ada. Feel free to discuss system design, scalability patterns, or high-level architecture with me.',
        },
        {
          code: 'SECURITY',
          name: 'Sentinel (Security)',
          avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=Sentinel',
          greeting: 'Security audit standing by. Drop me a line if you need risk evaluation, vulnerability assessments, or threat analysis.',
        },
        {
          code: 'PERFORMANCE',
          name: 'Turbo (Performance)',
          avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=Turbo',
          greeting: 'Ready to optimize! Send me questions about latency, memory consumption, or rapid execution protocols.',
        },
      ];

      return defaultAgents.map((agent) => ({
        conversationId: this.getConversationId(userId, agent.code),
        partnerId: agent.code,
        partnerType: 'AGENT',
        partnerName: agent.name,
        partnerAvatar: agent.avatar,
        lastMessage: agent.greeting,
        lastMessageAt: new Date(),
        isLastMessageMine: false,
        unreadCount: 0,
      }));
    }

    return Array.from(convMap.values());
  }

  /**
   * Get thread messages for a conversation
   */
  async getThread(conversationId: string, limit = 50): Promise<Message[]> {
    return this.messageModel
      .find({ conversationId })
      .sort({ createdAt: 1 })
      .limit(limit)
      .exec();
  }

  /**
   * Mark messages in conversation as read
   */
  async markAsRead(conversationId: string, userId: string): Promise<boolean> {
    await this.messageModel
      .updateMany(
        { conversationId, recipientId: userId, isRead: false },
        { $set: { isRead: true } }
      )
      .exec();
    return true;
  }

  /**
   * Send a direct message
   */
  async sendMessage(dto: SendMessageDto): Promise<{ message: Message; reply?: Message }> {
    const conversationId =
      dto.conversationId || this.getConversationId(dto.senderId, dto.recipientId);

    // Resolve sender details if missing
    let senderName = dto.senderName;
    let senderAvatar = dto.senderAvatar;
    if (!senderName) {
      const senderUser = await this.userModel.findById(dto.senderId).exec();
      if (senderUser) {
        senderName = senderUser.username || `${senderUser.firstName || ''} ${senderUser.lastName || ''}`.trim() || 'User';
        senderAvatar = senderUser.avatarUrl || '';
      }
    }

    // Resolve recipient details if missing
    let recipientName = dto.recipientName;
    let recipientAvatar = dto.recipientAvatar;
    const recipientCode = dto.recipientId.toUpperCase();
    const isAgent =
      dto.recipientType === 'AGENT' ||
      ['DEBUGGER', 'ARCHITECT', 'SECURITY', 'PERFORMANCE'].includes(recipientCode);

    if (isAgent && !recipientName) {
      const agentProfile = await this.agentModel.findOne({ agentCode: recipientCode }).exec();
      recipientName = agentProfile ? agentProfile.displayName : recipientCode;
      recipientAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${recipientName}`;
    } else if (!recipientName) {
      const recipientUser = await this.userModel.findById(dto.recipientId).exec();
      if (recipientUser) {
        recipientName = recipientUser.username || `${recipientUser.firstName || ''} ${recipientUser.lastName || ''}`.trim() || 'User';
        recipientAvatar = recipientUser.avatarUrl || '';
      }
    }

    const message = new this.messageModel({
      conversationId,
      senderId: dto.senderId,
      senderType: dto.senderType || 'USER',
      senderName: senderName || 'User',
      senderAvatar: senderAvatar || '',
      recipientId: dto.recipientId,
      recipientType: isAgent ? 'AGENT' : dto.recipientType || 'USER',
      recipientName: recipientName || dto.recipientId,
      recipientAvatar: recipientAvatar || '',
      content: dto.content.trim(),
      isRead: false,
    });

    const savedMessage = await message.save();

    // If message was sent to an AI Agent organism, generate an agent reply!
    let agentReply: Message | undefined;
    if (isAgent) {
      try {
        const replyText = await this.generateAgentReply(recipientCode, dto.content);
        const replyMsg = new this.messageModel({
          conversationId,
          senderId: dto.recipientId,
          senderType: 'AGENT',
          senderName: recipientName || recipientCode,
          senderAvatar: recipientAvatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${recipientCode}`,
          recipientId: dto.senderId,
          recipientType: dto.senderType || 'USER',
          recipientName: senderName || 'User',
          recipientAvatar: senderAvatar || '',
          content: replyText,
          isRead: false,
        });
        agentReply = await replyMsg.save();
      } catch (err: any) {
        this.logger.warn(`Failed to generate AI agent direct reply: ${err.message}`);
      }
    }

    return {
      message: savedMessage,
      reply: agentReply,
    };
  }

  /**
   * Generate an intelligent direct message reply from an AI Agent Organism
   */
  private async generateAgentReply(agentCode: string, userMessage: string): Promise<string> {
    const apiKey =
      this.configService.get<string>('OPEN_ROUTER_API') ||
      process.env.OPEN_ROUTER_API ||
      '';

    const agent = await this.agentModel.findOne({ agentCode }).exec();
    const systemPrompt =
      agent?.systemPrompt ||
      `You are ${agentCode}, a specialized digital citizen organism in the Opinions Poll ecosystem. Reply helpfully, concisely, and stay strictly in your unique persona.`;

    if (apiKey) {
      try {
        const { ChatOpenAI } = await import('@langchain/openai');
        const model = new ChatOpenAI({
          modelName: 'openai/gpt-4o-mini',
          openAIApiKey: apiKey,
          configuration: {
            baseURL: 'https://openrouter.ai/api/v1',
          },
          temperature: 0.7,
          maxTokens: 250,
        });

        const response = await model.invoke([
          { role: 'system', content: `${systemPrompt}\nKeep your response direct, friendly, and under 3-4 sentences.` },
          { role: 'user', content: userMessage },
        ]);

        if (response && response.content) {
          return typeof response.content === 'string'
            ? response.content.trim()
            : JSON.stringify(response.content);
        }
      } catch (err: any) {
        this.logger.warn(`OpenRouter DM reply fallback: ${err.message}`);
      }
    }

    // Persona-tailored fallback responses
    const fallbacks: Record<string, string> = {
      DEBUGGER: `Dexter here. I received your message: "${userMessage.substring(0, 60)}...". Let's investigate the specifics. If this relates to an issue or discussion, verify the exact error messages or edge cases so we can isolate the root cause!`,
      ARCHITECT: `Ada here. Regarding your note, I recommend analyzing this through modular boundaries and long-term stability. What are your core constraints and primary goals for this?`,
      SECURITY: `Sentinel here. Message received and logged. From a safety and risk audit perspective, ensure that any external inputs are validated and contingency measures are in place before proceeding.`,
      PERFORMANCE: `Turbo here. Read your message! If you need execution speed and minimal resource overhead, prioritize high-impact actions first and eliminate redundant steps.`,
    };

    return fallbacks[agentCode] || `Organism ${agentCode} received your message. I am actively monitoring our space memories and will factor this into our next sparring rounds!`;
  }
}
