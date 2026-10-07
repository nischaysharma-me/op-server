import { Injectable, OnModuleInit, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { AgentProfile, AgentProfileDocument } from './schemas/agent-profile.schema';
import { User, UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class AgentsService implements OnModuleInit {
  constructor(
    @InjectModel(AgentProfile.name)
    private readonly agentModel: Model<AgentProfileDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  async onModuleInit() {
    await this.seedDefaultAgents();
  }

  async findAll(): Promise<AgentProfile[]> {
    return this.agentModel.find({ isActive: true }).populate('userId').exec();
  }

  async findByCode(agentCode: string): Promise<AgentProfile> {
    const agent = await this.agentModel
      .findOne({ agentCode })
      .populate('userId')
      .exec();
    if (!agent) {
      throw new NotFoundException(`Agent with code ${agentCode} not found`);
    }
    return agent;
  }

  /**
   * Dynamic Human Persona Generator Pool:
   * Provides varied, culturally diverse, authentic human developer names
   */
  private static readonly NAME_POOLS: Record<string, string[]> = {
    DEBUGGER: [
      'Rajesh', 'Marcus', 'Devon', 'Vikram', 'Liam', 'Mateo', 'Kiran', 'Carlos', 'Tariq', 'Siddharth'
    ],
    ARCHITECT: [
      'Alice', 'Elena', 'Nadia', 'Priya', 'Chloe', 'Amara', 'Freja', 'Anya', 'Leila', 'Mei'
    ],
    SECURITY: [
      'Dan', 'Zane', 'Tariq', 'Arthur', 'Goran', 'Damian', 'Rohan', 'Kenji', 'Dmitri', 'Malik'
    ],
    PERFORMANCE: [
      'Maya', 'Sora', 'Zara', 'Camila', 'Anika', 'Beatriz', 'Ines', 'Yuki', 'Noor', 'Nia'
    ],
  };

  public generateDynamicName(archetype: string): string {
    const pool = AgentsService.NAME_POOLS[archetype.toUpperCase()] || [
      'Alex', 'Jordan', 'Taylor', 'Sam', 'Casey', 'Morgan', 'Avery', 'Robin'
    ];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  async seedDefaultAgents() {
    const archetypes = [
      {
        agentCode: 'DEBUGGER',
        specialty: 'Senior Full-Stack & Pragmatic Troubleshooter',
        email: 'agent.debugger@opinionpolls.ai',
        systemPromptBuilder: (name: string) =>
          `You are ${name}, an experienced developer and community forum member. You talk naturally and casually in the first person ('In my experience...', 'I ran into this a while back...', 'Here is my take...'). NEVER speak like an AI or chatbot. Do NOT use rigid headers like 'TITLE:' or 'EXPLANATION:'. Write authentic markdown comments. When discussing code, share realistic tips and snippets naturally. When discussing relationships, daily life, or general topics, speak warmly with genuine personal perspective.`,
      },
      {
        agentCode: 'ARCHITECT',
        specialty: 'Systems Architect & Deep Thinker',
        email: 'agent.architect@opinionpolls.ai',
        systemPromptBuilder: (name: string) =>
          `You are ${name}, an insightful, thoughtful community member who loves system design, narrative themes, and deep structure. You speak with clarity, nuance, and curiosity in the first person ('Looking at the big picture...', 'What is fascinating about this is...'). Never talk like a robot or use templated headers. Write naturally formatted forum posts with real perspective.`,
      },
      {
        agentCode: 'SECURITY',
        specialty: 'Security Engineer & Edge-Case Skeptic',
        email: 'agent.security@opinionpolls.ai',
        systemPromptBuilder: (name: string) =>
          `You are ${name}, a sharp-eyed forum regular who loves dissecting edge cases, security pitfalls, hidden caveats, and logical plot holes. You write in a direct, collegial tone ('Wait, aren't we overlooking...', 'One crucial gotcha to keep in mind is...'). Never output robotic audit labels or artificial AI disclaimers. Give authentic community critiques.`,
      },
      {
        agentCode: 'PERFORMANCE',
        specialty: 'Performance Hacker & High-Energy Builder',
        email: 'agent.perf@opinionpolls.ai',
        systemPromptBuilder: (name: string) =>
          `You are ${name}, a high-energy developer and community forum contributor obsessed with speed, clean execution, and practical results. You write informally, briskly, and encouragingly in the first person ('Quickest way to tackle this is...', 'Honestly, you could also just...'). Never use robotic prefixes or templated headers. Speak like an enthusiastic developer sharing a favorite trick or quick perspective.`,
      },
    ];

    for (const def of archetypes) {
      const existingAgent = await this.agentModel
        .findOne({ agentCode: def.agentCode })
        .exec();

      // If existing agent has a displayName, keep it; otherwise synthesize a natural human name from pool
      const dynamicName = existingAgent?.displayName || this.generateDynamicName(def.agentCode);
      const systemPrompt = def.systemPromptBuilder(dynamicName);

      let user = await this.userModel.findOne({ email: def.email }).exec();
      if (!user) {
        const dummyPassword = await bcrypt.hash('ai-agent-protected-key', 10);
        user = new this.userModel({
          username: dynamicName.toLowerCase(),
          email: def.email,
          password: dummyPassword,
          firstName: dynamicName,
          lastName: '',
          isAi: true,
          isVerified: true,
          reputation: 150,
        });
        await user.save();
      } else {
        user.username = dynamicName.toLowerCase();
        user.firstName = dynamicName;
        user.lastName = '';
        await user.save();
      }

      if (!existingAgent) {
        const profile = new this.agentModel({
          userId: user._id,
          agentCode: def.agentCode,
          displayName: dynamicName,
          specialty: def.specialty,
          systemPrompt,
          modelProvider: 'gemini-1.5-pro',
          temperature: 0.7,
          isActive: true,
        });
        await profile.save();
      } else {
        existingAgent.displayName = dynamicName;
        existingAgent.specialty = def.specialty;
        existingAgent.systemPrompt = systemPrompt;
        existingAgent.userId = user._id as any;
        await existingAgent.save();
      }
    }
  }
}
