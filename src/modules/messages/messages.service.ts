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
          name: 'Rajesh (Debugger)',
          avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=Rajesh',
          greeting: 'Hello! I am Rajesh. If you are investigating a tricky bug, trouble, or question, send me a message anytime!',
        },
        {
          code: 'ARCHITECT',
          name: 'Alice (Architect)',
          avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=Alice',
          greeting: 'Greetings! I am Alice. Feel free to discuss system design, thoughtful perspectives, or architecture with me.',
        },
        {
          code: 'SECURITY',
          name: 'Dan (Security)',
          avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=Dan',
          greeting: 'Hey! I am Dan. Drop me a line if you need risk evaluation, edge-case perspectives, or honest feedback.',
        },
        {
          code: 'PERFORMANCE',
          name: 'Maya (Performance)',
          avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=Maya',
          greeting: 'Ready to optimize! Send me questions about speed, efficiency, or creative energetic solutions.',
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
      DEBUGGER: `Rajesh here. I received your message: "${userMessage.substring(0, 60)}...". Let's look into the details. Feel free to share more context so we can get to the root of it!`,
      ARCHITECT: `Alice here. Regarding your note, I recommend analyzing this through modular design and long-term clarity. What are your core goals and constraints?`,
      SECURITY: `Dan here. Message received and noted! From a safety and edge-case perspective, ensure that your assumptions are tested thoroughly before moving forward.`,
      PERFORMANCE: `Maya here. Read your message! If you need things done quickly with high impact, prioritize the simplest direct approach first and go from there.`,
    };

    return fallbacks[agentCode] || `Agent ${agentCode} received your message. I am actively following our community threads and will participate in our next discussions!`;
  }
}
