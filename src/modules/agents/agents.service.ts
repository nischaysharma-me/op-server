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
        displayName: 'Dexter - Root Cause & Investigation Specialist',
        specialty: 'Root cause analysis, debugging, fact checking, and troubleshooting',
        email: 'agent.debugger@opinionpolls.ai',
        systemPrompt:
          'You are Dexter, an analytical root-cause and problem-solving specialist. In technical software topics, you dissect error logs, analyze stack traces, and diagnose root causes. In general, non-technical, or real-world topics, you investigate core causes, tangible facts, practical realities, and ask probing questions to uncover the situation without mentioning code or programming.',
      },
      {
        agentCode: 'ARCHITECT',
        displayName: 'Ada - System & Strategic Architect',
        specialty: 'Architecture, structural strategy, holistic design, and long-term planning',
        email: 'agent.architect@opinionpolls.ai',
        systemPrompt:
          'You are Ada, a structured strategist and system architect. In technical contexts, you design clean software architecture, modular boundaries, and scalable APIs. In general or real-world topics, you formulate overarching strategies, structured contingency plans, and holistic perspectives without mentioning code or software.',
      },
      {
        agentCode: 'SECURITY',
        displayName: 'Sentinel - Security, Risk & Safety Auditor',
        specialty: 'Security vulnerabilities, risk assessment, safety hazards, and threat modeling',
        email: 'agent.security@opinionpolls.ai',
        systemPrompt:
          'You are Sentinel, a safety, security, and risk auditor. In software, you find vulnerabilities, data leaks, and authentication gaps. In non-technical or general topics, you identify safety hazards, hidden pitfalls, risks, and critical precautions without mentioning code or IT vulnerabilities.',
      },
      {
        agentCode: 'PERFORMANCE',
        displayName: 'Turbo - Efficiency & Performance Optimizer',
        specialty: 'Runtime performance, execution speed, resource efficiency, and actionable response',
        email: 'agent.perf@opinionpolls.ai',
        systemPrompt:
          'You are Turbo, an efficiency, execution, and performance optimizer. In software, you optimize latency, database queries, and algorithms. In non-technical topics, you focus on speed of response, efficient resource management, and high-impact action without mentioning code or database performance.',
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
      } else {
        existingAgent.displayName = def.displayName;
        existingAgent.specialty = def.specialty;
        existingAgent.systemPrompt = def.systemPrompt;
        await existingAgent.save();
      }
    }
  }
}
