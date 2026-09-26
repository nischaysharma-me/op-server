import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import axios from 'axios';
import { SparringConfig, SparringConfigDocument } from './schemas/sparring-config.schema';
import { AgentProfile, AgentProfileDocument } from '../agents/schemas/agent-profile.schema';
import { UpdateSparringConfigDto } from './dto/update-sparring-config.dto';

export interface EnrichedModel {
  id: string;
  name: string;
  description: string;
  contextLength: number;
  provider: string;
  isFree: boolean;
  pricing: {
    promptPerMillion: number;
    completionPerMillion: number;
    rawPrompt: string;
    rawCompletion: string;
  };
  architecture?: {
    modality: string;
    tokenizer: string;
  };
  isModerated?: boolean;
}

@Injectable()
export class ModelsService {
  private readonly logger = new Logger(ModelsService.name);
  private cachedModels: EnrichedModel[] = [];
  private lastFetchTime = 0;
  private readonly CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

  constructor(
    private readonly configService: ConfigService,
    @InjectModel(SparringConfig.name)
    private readonly configModel: Model<SparringConfigDocument>,
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

  async fetchOpenRouterModels(forceRefresh = false): Promise<EnrichedModel[]> {
    const now = Date.now();
    if (!forceRefresh && this.cachedModels.length > 0 && now - this.lastFetchTime < this.CACHE_TTL_MS) {
      return this.cachedModels;
    }

    try {
      const apiKey = this.getApiKey();
      const headers: Record<string, string> = {
        'HTTP-Referer': 'http://localhost:4000',
        'X-Title': 'Opinions Poll Model Explorer',
      };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const response = await axios.get('https://openrouter.ai/api/v1/models', {
        headers,
        timeout: 10000,
      });

      const rawList = response.data?.data || [];
      const enriched: EnrichedModel[] = rawList.map((m: any) => {
        const idParts = (m.id || '').split('/');
        const provider = idParts.length > 1 ? idParts[0] : 'other';
        const rawPrompt = m.pricing?.prompt || '0';
        const rawComp = m.pricing?.completion || '0';
        const promptPerM = parseFloat(rawPrompt) * 1_000_000;
        const compPerM = parseFloat(rawComp) * 1_000_000;
        const isFree =
          m.id.endsWith(':free') ||
          (parseFloat(rawPrompt) === 0 && parseFloat(rawComp) === 0);

        return {
          id: m.id,
          name: m.name || m.id,
          description: m.description || '',
          contextLength: m.context_length || 8192,
          provider,
          isFree,
          pricing: {
            promptPerMillion: Math.round(promptPerM * 100) / 100,
            completionPerMillion: Math.round(compPerM * 100) / 100,
            rawPrompt,
            rawCompletion: rawComp,
          },
          architecture: {
            modality: m.architecture?.modality || 'text->text',
            tokenizer: m.architecture?.tokenizer || 'standard',
          },
          isModerated: m.top_provider?.is_moderated || false,
        };
      });

      // Sort: free models and top models first, then alphabetical
      enriched.sort((a, b) => {
        if (a.isFree && !b.isFree) return -1;
        if (!a.isFree && b.isFree) return 1;
        return a.name.localeCompare(b.name);
      });

      this.cachedModels = enriched;
      this.lastFetchTime = now;
      this.logger.log(`Successfully fetched and enriched ${enriched.length} models from OpenRouter`);
      return enriched;
    } catch (error: any) {
      this.logger.error(`Error fetching models from OpenRouter: ${error.message}`);
      if (this.cachedModels.length > 0) {
        return this.cachedModels;
      }
      return this.getFallbackModels();
    }
  }

  async getModelStats() {
    const models = await this.fetchOpenRouterModels();
    const providers = Array.from(new Set(models.map((m) => m.provider))).sort();
    const freeCount = models.filter((m) => m.isFree).length;

    return {
      totalModels: models.length,
      freeModels: freeCount,
      paidModels: models.length - freeCount,
      providersCount: providers.length,
      providers,
      hasApiKey: !!this.getApiKey(),
    };
  }

  async getSparringConfig(): Promise<SparringConfig> {
    let config = await this.configModel.findOne({ configKey: 'default' }).exec();
    if (!config) {
      config = new this.configModel({ configKey: 'default' });
      await config.save();
    }
    return config;
  }

  async updateSparringConfig(dto: UpdateSparringConfigDto): Promise<SparringConfig> {
    let config = await this.configModel.findOne({ configKey: 'default' }).exec();
    if (!config) {
      config = new this.configModel({ configKey: 'default' });
    }

    if (dto.agentModelMap) {
      config.agentModelMap = {
        ...config.agentModelMap,
        ...dto.agentModelMap,
      };

      // Also sync to AgentProfile documents in database
      for (const [agentCode, modelProvider] of Object.entries(dto.agentModelMap)) {
        await this.agentModel.updateOne(
          { agentCode },
          { $set: { modelProvider } },
        );
      }
    }

    if (dto.activeSparringModels) {
      config.activeSparringModels = dto.activeSparringModels;
    }

    if (dto.defaultModel) {
      config.defaultModel = dto.defaultModel;
    }

    await config.save();
    return config;
  }

  private getFallbackModels(): EnrichedModel[] {
    return [
      {
        id: 'google/gemma-4-31b-it:free',
        name: 'Google: Gemma 4 31B (Free)',
        description: 'Lightweight, state-of-the-art open model from Google trained on Gemini technology.',
        contextLength: 131072,
        provider: 'google',
        isFree: true,
        pricing: { promptPerMillion: 0, completionPerMillion: 0, rawPrompt: '0', rawCompletion: '0' },
      },
      {
        id: 'meta-llama/llama-3.3-70b-instruct',
        name: 'Meta: Llama 3.3 70B Instruct',
        description: 'Meta state-of-the-art open weights LLM for code, system reasoning, and instruction following.',
        contextLength: 128000,
        provider: 'meta-llama',
        isFree: false,
        pricing: { promptPerMillion: 0.35, completionPerMillion: 0.40, rawPrompt: '0.00000035', rawCompletion: '0.0000004' },
      },
      {
        id: 'anthropic/claude-3.5-sonnet',
        name: 'Anthropic: Claude 3.5 Sonnet',
        description: 'Industry-leading software architecture and coding model by Anthropic.',
        contextLength: 200000,
        provider: 'anthropic',
        isFree: false,
        pricing: { promptPerMillion: 3.00, completionPerMillion: 15.00, rawPrompt: '0.000003', rawCompletion: '0.000015' },
      },
      {
        id: 'openai/gpt-4o',
        name: 'OpenAI: GPT-4o',
        description: 'Flagship omni model from OpenAI with strong multimodal and coding capabilities.',
        contextLength: 128000,
        provider: 'openai',
        isFree: false,
        pricing: { promptPerMillion: 2.50, completionPerMillion: 10.00, rawPrompt: '0.0000025', rawCompletion: '0.00001' },
      },
      {
        id: 'deepseek/deepseek-chat',
        name: 'DeepSeek: V3',
        description: 'High performance open-weights MoE model engineered for advanced problem solving and programming.',
        contextLength: 64000,
        provider: 'deepseek',
        isFree: false,
        pricing: { promptPerMillion: 0.14, completionPerMillion: 0.28, rawPrompt: '0.00000014', rawCompletion: '0.00000028' },
      },
    ];
  }
}
