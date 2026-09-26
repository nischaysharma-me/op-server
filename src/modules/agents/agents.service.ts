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

  async seedDefaultAgents() {
    const defaultAgents = [
      {
        agentCode: 'DEBUGGER',
        displayName: 'Dexter - Root Cause & Debugging Specialist',
        specialty: 'Stack traces, runtime exceptions, memory leaks, and reproduction steps',
        email: 'agent.debugger@opinionpolls.ai',
        systemPrompt:
          'You are a meticulous debugging specialist. Your job is to dissect error logs, analyze stack traces, uncover root causes, and cross-question developers on reproduction steps and environment context.',
      },
      {
        agentCode: 'ARCHITECT',
        displayName: 'Ada - System & API Architect',
        specialty: 'System design, modular NestJS patterns, clean architecture, and scalability',
        email: 'agent.architect@opinionpolls.ai',
        systemPrompt:
          'You are a pragmatic system architect. You evaluate architectural patterns, data flow, coupling, and recommend robust, maintainable structural patterns.',
      },
      {
        agentCode: 'SECURITY',
        displayName: 'Sentinel - Security & Vulnerability Auditor',
        specialty: 'Authentication, input sanitization, injection flaws, and authorization',
        email: 'agent.security@opinionpolls.ai',
        systemPrompt:
          'You are a security auditor. You scrutinize code for security vulnerabilities, authentication/authorization gaps, data leaks, and insecure dependencies.',
      },
      {
        agentCode: 'PERFORMANCE',
        displayName: 'Turbo - Performance & Database Optimizer',
        specialty: 'Query optimization, indexes, asynchronous event loops, and latency',
        email: 'agent.perf@opinionpolls.ai',
        systemPrompt:
          'You are a database and runtime performance expert. You look for N+1 queries, unindexed lookups, event loop blocks, and memory overhead.',
      },
    ];

    for (const def of defaultAgents) {
      const existingAgent = await this.agentModel
        .findOne({ agentCode: def.agentCode })
        .exec();
      if (!existingAgent) {
        let user = await this.userModel.findOne({ email: def.email }).exec();
        if (!user) {
          const dummyPassword = await bcrypt.hash('ai-agent-protected-key', 10);
          user = new this.userModel({
            username: def.agentCode.toLowerCase() + '_agent',
            email: def.email,
            password: dummyPassword,
            firstName: def.displayName.split(' ')[0],
            lastName: 'AI',
            isAi: true,
            isVerified: true,
            reputation: 100,
          });
          await user.save();
        }

        const profile = new this.agentModel({
          userId: user._id,
          agentCode: def.agentCode,
          displayName: def.displayName,
          specialty: def.specialty,
          systemPrompt: def.systemPrompt,
          modelProvider: 'gemini-1.5-pro',
          temperature: 0.7,
          isActive: true,
        });
        await profile.save();
      }
    }
  }
}
