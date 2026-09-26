import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentMemory, AgentMemoryDocument, MemoryType } from './schemas/agent-memory.schema';
import { AgentProfile, AgentProfileDocument } from './schemas/agent-profile.schema';

export interface NeuronTopologyNode {
  id: string;
  x: number;
  y: number;
  z: number;
  cluster: string;
  intensity: number;
  memoryId?: string;
  label: string;
}

export interface BrainStateResponse {
  agentCode: string;
  displayName: string;
  specialty: string;
  modelProvider: string;
  status: string;
  pineconeStatus: {
    isConfigured: boolean;
    indexName: string;
    totalVectors: number;
  };
  metrics: {
    totalMemories: number;
    episodicCount: number;
    semanticCount: number;
    reflexiveCount: number;
    solutionsCount: number;
    neuronCount: number;
  };
  cognitiveClusters: string[];
  recentThoughts: Array<{
    title: string;
    type: string;
    summary: string;
    importance: number;
    timeAgo: string;
  }>;
  topology: NeuronTopologyNode[];
}

@Injectable()
export class AgentMemoryService implements OnModuleInit {
  private readonly logger = new Logger(AgentMemoryService.name);
  private pineconeClient: any = null;
  private isPineconeReady = false;
  private pineconeIndexName = '';

  constructor(
    private readonly configService: ConfigService,
    @InjectModel(AgentMemory.name)
    private readonly memoryModel: Model<AgentMemoryDocument>,
    @InjectModel(AgentProfile.name)
    private readonly agentModel: Model<AgentProfileDocument>,
  ) {}

  async onModuleInit() {
    await this.initPinecone();
    await this.seedDefaultMemories();
  }

  private async initPinecone() {
    const apiKey =
      this.configService.get<string>('PINECONE_API_KEY') ||
      process.env.PINECONE_API_KEY ||
      '';
    const indexName =
      this.configService.get<string>('PINECONE_INDEX') ||
      process.env.PINECONE_INDEX ||
      'opinion-polls-agents';

    this.pineconeIndexName = indexName;

    if (!apiKey) {
      this.logger.log(
        'Pinecone API key not found in environment. Utilizing high-performance local MongoDB memory store with semantic text indexing.'
      );
      this.isPineconeReady = false;
      return;
    }

    try {
      const { Pinecone } = await import('@pinecone-database/pinecone');
      this.pineconeClient = new Pinecone({ apiKey });
      this.isPineconeReady = true;
      this.logger.log(`Pinecone client successfully initialized with index "${indexName}".`);
    } catch (err: any) {
      this.logger.warn(`Pinecone initialization deferred: ${err.message}. Operating with local memory store.`);
      this.isPineconeReady = false;
    }
  }

  /**
   * Retrieves comprehensive Brain State and Cognitive Metrics for an Agent
   */
  async getBrainState(agentCode: string): Promise<BrainStateResponse> {
    const agent = await this.agentModel.findOne({ agentCode }).populate('userId').exec();
    const memories = await this.memoryModel.find({ agentCode }).sort({ createdAt: -1 }).exec();

    const episodicCount = memories.filter((m) => m.memoryType === MemoryType.EPISODIC).length;
    const semanticCount = memories.filter((m) => m.memoryType === MemoryType.SEMANTIC).length;
    const reflexiveCount = memories.filter((m) => m.memoryType === MemoryType.REFLEXIVE).length;
    const solutionsCount = memories.filter((m) => m.memoryType === MemoryType.SOLUTION_KNOWLEDGE).length;

    // Generate clusters based on agent code
    const clustersMap: Record<string, string[]> = {
      DEBUGGER: ['Root Cause Analysis', 'Event Listener Leaks', 'Stack Trace Decoding', 'Real-world Investigation'],
      ARCHITECT: ['Structural Decoupling', 'Connection Pooling', 'Contingency Frameworks', 'Hexagonal Modularity'],
      SECURITY: ['DoS Attack Vectors', 'Physical Safety Auditing', 'Socket Teardown Sanitization', 'Risk Mitigation'],
      PERFORMANCE: ['Heap Allocation Bounds', 'GC Pressure Minimization', 'Emergency Resource Optimization', 'Loop Non-Blocking'],
    };

    const cognitiveClusters = clustersMap[agentCode] || ['Analytical Core', 'Decision Matrix', 'Memory Storage'];

    // Generate 3D Neuron Topology Points
    const topology: NeuronTopologyNode[] = this.generateNeuronTopology(agentCode, memories);

    const recentThoughts = memories.slice(0, 5).map((m) => ({
      title: m.title,
      type: m.memoryType,
      summary: m.summary || m.content.substring(0, 140) + '...',
      importance: m.importanceScore,
      timeAgo: this.formatTimeAgo(m.lastRecalledAt || (m as any).createdAt),
    }));

    return {
      agentCode,
      displayName: agent ? agent.displayName : agentCode,
      specialty: agent ? agent.specialty : 'Cognitive AI Specialist',
      modelProvider: agent ? (agent as any).modelProvider : 'OpenRouter / LangChain',
      status: agent && (agent as any).isActive === false ? 'Inactive' : 'Active & Sparring Ready',
      pineconeStatus: {
        isConfigured: this.isPineconeReady,
        indexName: this.pineconeIndexName,
        totalVectors: memories.filter((m) => m.isIndexedInPinecone).length,
      },
      metrics: {
        totalMemories: memories.length,
        episodicCount,
        semanticCount,
        reflexiveCount,
        solutionsCount,
        neuronCount: topology.length,
      },
      cognitiveClusters,
      recentThoughts,
      topology,
    };
  }

  /**
   * Search memory bank using RAG (Pinecone vector search with MongoDB semantic fallback)
   */
  async searchMemories(agentCode: string, query: string, topK = 10): Promise<AgentMemory[]> {
    if (!query || query.trim().length === 0) {
      return this.memoryModel.find({ agentCode }).sort({ importanceScore: -1 }).limit(topK).exec();
    }

    // If Pinecone is ready and configured, query vector index
    if (this.isPineconeReady && this.pineconeClient) {
      try {
        const embeddings = await this.pineconeClient.inference.embed({
          model: 'multilingual-e5-large',
          inputs: [query.trim()],
          parameters: { input_type: 'query' },
        });

        if (embeddings && embeddings.data && embeddings.data.length > 0) {
          const index = this.pineconeClient.index(this.pineconeIndexName);
          const queryResponse = await index.query({
            vector: embeddings.data[0].values,
            topK,
            filter: { agentCode: { $eq: agentCode } },
            includeMetadata: true,
          });

          if (queryResponse.matches && queryResponse.matches.length > 0) {
            const memoryIds = queryResponse.matches
              .map((m: any) => m.metadata?.mongoId)
              .filter(Boolean);
            if (memoryIds.length > 0) {
              const pineconeMatched = await this.memoryModel
                .find({ _id: { $in: memoryIds }, agentCode })
                .exec();
              if (pineconeMatched.length > 0) {
                return pineconeMatched;
              }
            }
          }
        }
      } catch (err: any) {
        this.logger.warn(`Pinecone vector search query fallback to MongoDB: ${err.message}`);
      }
    }

    // High performance MongoDB regex & text fallback
    const regex = new RegExp(query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    return this.memoryModel
      .find({
        agentCode,
        $or: [{ title: regex }, { content: regex }, { keywords: regex }, { tags: regex }],
      })
      .sort({ importanceScore: -1 })
      .limit(topK)
      .exec();
  }

  /**
   * List memories for an agent
   */
  async getMemories(agentCode: string, type?: string): Promise<AgentMemory[]> {
    const filter: any = { agentCode };
    if (type) filter.memoryType = type;
    return this.memoryModel.find(filter).sort({ createdAt: -1 }).exec();
  }

  /**
   * Add a new memory to this Agent Organism's brain
   */
  async addMemory(
    agentCode: string,
    memoryData: {
      title: string;
      content: string;
      memoryType?: MemoryType;
      keywords?: string[];
      tags?: string[];
      importanceScore?: number;
    },
  ): Promise<AgentMemory> {
    const memory = new this.memoryModel({
      agentCode,
      memoryType: memoryData.memoryType || MemoryType.SEMANTIC,
      title: memoryData.title,
      content: memoryData.content,
      summary: memoryData.content.substring(0, 140),
      keywords: memoryData.keywords || [],
      tags: memoryData.tags || [],
      importanceScore: memoryData.importanceScore || 6,
      pineconeId: `mem_${agentCode.toLowerCase()}_${Date.now()}`,
      isIndexedInPinecone: false,
    });

    const saved = await memory.save();

    // If Pinecone is active, generate embedding and push vector record
    if (this.isPineconeReady && this.pineconeClient) {
      try {
        const embeddings = await this.pineconeClient.inference.embed({
          model: 'multilingual-e5-large',
          inputs: [memoryData.content],
          parameters: { input_type: 'passage', truncate: 'END' },
        });

        if (embeddings && embeddings.data && embeddings.data.length > 0) {
          const index = this.pineconeClient.index(this.pineconeIndexName);
          await index.upsert([
            {
              id: saved.pineconeId,
              values: embeddings.data[0].values,
              metadata: {
                mongoId: (saved as any)._id.toString(),
                agentCode,
                title: saved.title,
                memoryType: saved.memoryType,
                importance: saved.importanceScore,
              },
            },
          ]);
          saved.isIndexedInPinecone = true;
          await saved.save();
        }
      } catch (err: any) {
        this.logger.warn(`Failed to upsert to Pinecone: ${err.message}`);
      }
    }

    return saved;
  }

  /**
   * Generate 3D Neuron Topology Points for the interactive WebGL Canvas
   */
  private generateNeuronTopology(agentCode: string, memories: AgentMemoryDocument[]): NeuronTopologyNode[] {
    const nodes: NeuronTopologyNode[] = [];
    const count = Math.max(50, Math.min(100, memories.length * 10 + 40));

    for (let i = 0; i < count; i++) {
      // Create dual hemisphere ellipsoid brain shape
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      const r = 2.4 + (Math.random() - 0.5) * 0.4;

      // Hemispheric split
      const hemisphere = i % 2 === 0 ? 1 : -1;
      const x = r * Math.sin(phi) * Math.cos(theta) * 0.9 + hemisphere * 0.35;
      const y = r * Math.sin(phi) * Math.sin(theta) * 0.75;
      const z = r * Math.cos(phi) * 1.1;

      const mem = memories[i % memories.length];

      nodes.push({
        id: `neuron_${agentCode}_${i}`,
        x: parseFloat(x.toFixed(3)),
        y: parseFloat(y.toFixed(3)),
        z: parseFloat(z.toFixed(3)),
        cluster: mem ? mem.title : `Synaptic Cluster ${i % 5 + 1}`,
        intensity: Math.random() * 0.6 + 0.4,
        memoryId: mem ? (mem as any)._id.toString() : undefined,
        label: mem ? mem.title : `Synapse #${i + 1}`,
      });
    }

    return nodes;
  }

  private formatTimeAgo(date: Date): string {
    const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  /**
   * Seed foundational memories for each digital citizen organism
   */
  async seedDefaultMemories() {
    const count = await this.memoryModel.countDocuments().exec();
    if (count > 0) return;

    this.logger.log('Seeding foundational space memories for digital citizen organisms...');

    const seeds = [
      // Dexter (Debugger / Pragmatist)
      {
        agentCode: 'DEBUGGER',
        memoryType: MemoryType.SOLUTION_KNOWLEDGE,
        title: 'Event Listener Closure Leaks in WebSocket Servers',
        content:
          'When WebSocket connections terminate without explicit removal of message and error listeners, the retained closure references prevent the V8 garbage collector from reclaiming allocated socket memory buffers.',
        keywords: ['websocket', 'event-listener', 'memory-leak', 'closure', 'garbage-collection'],
        tags: ['nodejs', 'sockets', 'memory'],
        importanceScore: 10,
      },
      {
        agentCode: 'DEBUGGER',
        memoryType: MemoryType.EPISODIC,
        title: 'Severe Storm Physical Preparedness Assessment',
        content:
          'During severe weather events, personal shelter security and reliable emergency communication must be verified first. Real-world trouble analysis requires examining physical safety conditions before secondary plans.',
        keywords: ['storm', 'weather', 'safety', 'investigation', 'preparedness'],
        tags: ['real-world', 'safety', 'emergency'],
        importanceScore: 9,
      },
      {
        agentCode: 'DEBUGGER',
        memoryType: MemoryType.SEMANTIC,
        title: 'Nested Asynchronous Call-Site Stack Trace Demarcation',
        content:
          'In async/await flows, unhandled rejections often lose the origin call-site. Inspecting the top microtask frame and event loop tick identifies the true failure root cause.',
        keywords: ['async', 'stack-trace', 'microtask', 'root-cause'],
        tags: ['debugging', 'v8', 'promises'],
        importanceScore: 8,
      },

      // Ada (System & Strategic Architect)
      {
        agentCode: 'ARCHITECT',
        memoryType: MemoryType.SOLUTION_KNOWLEDGE,
        title: 'WeakMap Instance Registry for Circular Reference Decoupling',
        content:
          'Wrapping instance metadata in an ephemeral WeakMap registry decouples state lifecycle from the long-lived socket instance, guaranteeing automatic garbage collection upon handle destruction.',
        keywords: ['weakmap', 'registry', 'decoupling', 'architecture', 'circular-references'],
        tags: ['patterns', 'clean-architecture', 'memory'],
        importanceScore: 10,
      },
      {
        agentCode: 'ARCHITECT',
        memoryType: MemoryType.SEMANTIC,
        title: 'Multi-Phase Contingency and Continuity Framework',
        content:
          'Unforeseen external disruptions require a structured layered response: Phase 1 Hazard Mitigation, Phase 2 Resource & Communication Continuity, Phase 3 Post-Event Stabilization.',
        keywords: ['contingency', 'strategy', 'resilience', 'continuity', 'framework'],
        tags: ['strategy', 'planning', 'framework'],
        importanceScore: 9,
      },
      {
        agentCode: 'ARCHITECT',
        memoryType: MemoryType.REFLEXIVE,
        title: 'Hexagonal Domain Boundary Isolation',
        content:
          'Business core entities must never import database or network transport modules directly. Ports and adapters guarantee evolutionary scalability.',
        keywords: ['hexagonal', 'ports-and-adapters', 'domain-driven', 'modularity'],
        tags: ['architecture', 'ddd'],
        importanceScore: 8,
      },

      // Sentinel (Security & Safety Auditor)
      {
        agentCode: 'SECURITY',
        memoryType: MemoryType.SOLUTION_KNOWLEDGE,
        title: 'Slowloris and Socket Handle Denial-of-Service Defense',
        content:
          'Lingering unauthenticated sockets can hold file descriptors indefinitely. Implementing handshake timeouts and maximum idle thresholds eliminates slowloris resource exhaustion.',
        keywords: ['slowloris', 'dos', 'file-descriptors', 'timeouts', 'audit'],
        tags: ['security', 'dos', 'network'],
        importanceScore: 10,
      },
      {
        agentCode: 'SECURITY',
        memoryType: MemoryType.EPISODIC,
        title: 'Critical Emergency Vulnerability Hazard Assessment',
        content:
          'Outdoor damage inspections must never proceed before assessing downed power lines, structural compromise, and gas/water line integrity following severe storms.',
        keywords: ['hazard', 'safety-audit', 'power-lines', 'vulnerability'],
        tags: ['safety', 'risk', 'emergency'],
        importanceScore: 9,
      },

      // Turbo (Performance & Execution Specialist)
      {
        agentCode: 'PERFORMANCE',
        memoryType: MemoryType.SOLUTION_KNOWLEDGE,
        title: 'Heap Climb Stabilization Across 10,000 Disconnection Cycles',
        content:
          'Empirical benchmarks verify that listener cleanup halts heap climb at 120MB compared to 1.8GB uncleaned, reducing V8 GC pause times by 84%.',
        keywords: ['heap', 'benchmarks', 'gc-pause', 'latency', 'optimization'],
        tags: ['performance', 'benchmarks', 'memory'],
        importanceScore: 10,
      },
      {
        agentCode: 'PERFORMANCE',
        memoryType: MemoryType.SEMANTIC,
        title: 'High-Impact Rapid Resource Conservation Protocol',
        content:
          'In crisis situations, swift sequencing of highest-impact actions first conserves finite energy, battery, and heating reserves before addressing broad tasks.',
        keywords: ['rapid-execution', 'resource-conservation', 'efficiency', 'impact'],
        tags: ['efficiency', 'execution'],
        importanceScore: 9,
      },
    ];

    for (const seed of seeds) {
      await this.addMemory(seed.agentCode, seed);
    }

    this.logger.log('Foundational space memories successfully planted.');
  }
}
