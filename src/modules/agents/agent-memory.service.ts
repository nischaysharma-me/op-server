import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentMemory, AgentMemoryDocument, MemoryType } from './schemas/agent-memory.schema';
import { AgentProfile, AgentProfileDocument } from './schemas/agent-profile.schema';

import { Organism, OrganismDocument } from '../organisms/schemas/organism.schema';
import { Opinion, OpinionDocument } from '../opinions/schemas/opinion.schema';
import { Comment, CommentDocument } from '../comments/schemas/comment.schema';
import { Issue, IssueDocument } from '../issues/schemas/issue.schema';

export interface NeuronTopologyNode {
  id: string;
  x: number;
  y: number;
  z: number;
  cluster: string;
  intensity: number;
  memoryId?: string;
  label: string;
  lobe: string;
  type: string;
  vectorPreview: number[];
}

export interface NervePathway {
  id: string;
  name: string;
  description: string;
  color: string;
  points: Array<{ x: number; y: number; z: number }>;
}

export interface BrainStateResponse {
  agentCode: string;
  displayName: string;
  specialty: string;
  systemPrompt?: string;
  modelProvider: string;
  status: string;
  organism?: {
    organismCode: string;
    name: string;
    generation: number;
    lifeStage: string;
    ageTicks: number;
    lifespan: number;
    maturityAge: number;
    fitnessScore: number;
    assignedModel: string;
    traits: string[];
    temperature: number;
    debateAggressiveness: number;
    mutationRate: number;
    creativityBias: number;
    memoryRetention: number;
    stats: {
      debatesParticipated: number;
      solutionsProposed: number;
      crossQuestionsAsked: number;
      upvotesReceived: number;
    };
    lastActionTimestamp?: Date | null;
    cooldownConfigSeconds: number;
    cooldownRemainingSeconds: number;
    isCoolingDown: boolean;
  } | null;
  pineconeStatus: {
    isConfigured: boolean;
    indexName: string;
    totalVectors: number;
    dimension: number;
    metric: string;
    embeddingModel: string;
    storageType: string;
  };
  metrics: {
    totalMemories: number;
    episodicCount: number;
    semanticCount: number;
    reflexiveCount: number;
    solutionsCount: number;
    neuronCount: number;
    axonsCount: number;
    nerveTractsCount: number;
  };
  cognitiveClusters: string[];
  recentThoughts: Array<{
    title: string;
    type: string;
    summary: string;
    importance: number;
    timeAgo: string;
  }>;
  recentActivities: Array<{
    id: string;
    type: 'OPINION' | 'COMMENT';
    issueId: string;
    issueTitle: string;
    content: string;
    createdAt: Date;
    timeAgo: string;
    confidenceScore?: number;
  }>;
  topology: NeuronTopologyNode[];
  nervePathways: NervePathway[];
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
    @InjectModel(Organism.name)
    private readonly organismModel: Model<OrganismDocument>,
    @InjectModel(Opinion.name)
    private readonly opinionModel: Model<OpinionDocument>,
    @InjectModel(Comment.name)
    private readonly commentModel: Model<CommentDocument>,
    @InjectModel(Issue.name)
    private readonly issueModel: Model<IssueDocument>,
  ) {}

  async onModuleInit() {
    await this.initPinecone();
    await this.seedDefaultMemories();
    await this.syncUnindexedMemories();
  }

  private async initPinecone() {
    const apiKey =
      this.configService.get<string>('PINECONE_API_KEY') ||
      process.env.PINECONE_API_KEY ||
      '';
    const indexName =
      this.configService.get<string>('PINECONE_INDEX') ||
      process.env.PINECONE_INDEX ||
      'opinions-poll-agents';

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

    // Query the living Organism profile for genetic and life cycle stats
    const organismDoc = await this.organismModel.findOne({ 'genome.archetype': agentCode }).exec();
    const cooldownConfigSeconds = parseInt(process.env.AGENT_COOLDOWN_SECONDS || '20', 10);
    let cooldownRemainingSeconds = 0;
    let isCoolingDown = false;
    if (organismDoc?.lastActionTimestamp) {
      const elapsedSec = Math.floor((Date.now() - new Date(organismDoc.lastActionTimestamp).getTime()) / 1000);
      cooldownRemainingSeconds = Math.max(0, cooldownConfigSeconds - elapsedSec);
      isCoolingDown = cooldownRemainingSeconds > 0;
    }

    const organismData = organismDoc
      ? {
          organismCode: organismDoc.organismCode,
          name: organismDoc.name,
          generation: organismDoc.generation,
          lifeStage: organismDoc.lifeStage,
          ageTicks: organismDoc.ageTicks,
          lifespan: organismDoc.lifespan,
          maturityAge: organismDoc.maturityAge,
          fitnessScore: organismDoc.fitnessScore,
          assignedModel: organismDoc.assignedModel,
          traits: organismDoc.genome?.traits || [],
          temperature: organismDoc.genome?.temperature ?? 0.7,
          debateAggressiveness: organismDoc.genome?.debateAggressiveness ?? 0.6,
          mutationRate: organismDoc.genome?.mutationRate ?? 0.08,
          creativityBias: organismDoc.genome?.creativityBias ?? 0.5,
          memoryRetention: organismDoc.genome?.memoryRetention ?? 0.8,
          stats: organismDoc.stats,
          lastActionTimestamp: organismDoc.lastActionTimestamp,
          cooldownConfigSeconds,
          cooldownRemainingSeconds,
          isCoolingDown,
        }
      : null;

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

    // Generate 3D Neuron Topology Points & Nerve Pathways
    const topology: NeuronTopologyNode[] = this.generateNeuronTopology(agentCode, memories);
    const nervePathways: NervePathway[] = this.generateNervePathways(agentCode);

    const recentThoughts = memories.slice(0, 5).map((m) => ({
      title: m.title,
      type: m.memoryType,
      summary: m.summary || m.content.substring(0, 140) + '...',
      importance: m.importanceScore,
      timeAgo: this.formatTimeAgo(m.lastRecalledAt || (m as any).createdAt),
    }));

    // Query recent opinions and comments on troubles by this agent
    const [recentOps, recentComms] = await Promise.all([
      this.opinionModel
        .find({ agentCode })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('issueId', 'title')
        .exec(),
      this.commentModel
        .find({ agentCode })
        .sort({ createdAt: -1 })
        .limit(5)
        .exec(),
    ]);

    const recentActivities: BrainStateResponse['recentActivities'] = [];

    for (const op of recentOps) {
      const issueTitle = (op.issueId as any)?.title || 'Trouble Thread';
      recentActivities.push({
        id: op._id.toString(),
        type: 'OPINION',
        issueId: (op.issueId as any)?._id?.toString() || op.issueId?.toString() || '',
        issueTitle,
        content: op.content,
        createdAt: (op as any).createdAt,
        timeAgo: this.formatTimeAgo((op as any).createdAt || new Date()),
        confidenceScore: op.confidenceScore,
      });
    }

    for (const comm of recentComms) {
      recentActivities.push({
        id: comm._id.toString(),
        type: 'COMMENT',
        issueId: comm.targetId ? comm.targetId.toString() : '',
        issueTitle: 'Discussion Comment',
        content: comm.content,
        createdAt: (comm as any).createdAt,
        timeAgo: this.formatTimeAgo((comm as any).createdAt || new Date()),
      });
    }

    recentActivities.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    let totalVectors = memories.filter((m) => m.isIndexedInPinecone).length;
    if (this.isPineconeReady && this.pineconeClient) {
      try {
        const stats = await this.pineconeClient.index(this.pineconeIndexName).describeIndexStats();
        if (typeof stats?.totalRecordCount === 'number') {
          totalVectors = stats.totalRecordCount;
        }
      } catch (err: any) {
        // Fallback to local memory count
      }
    }

    return {
      agentCode,
      displayName: agent ? agent.displayName : agentCode,
      specialty: agent ? agent.specialty : 'Cognitive AI Specialist',
      systemPrompt: agent ? agent.systemPrompt : undefined,
      modelProvider: organismData?.assignedModel || (agent ? (agent as any).modelProvider : 'OpenRouter / LangChain'),
      status: agent && (agent as any).isActive === false ? 'Inactive' : 'Active & Ready to Spar',
      organism: organismData,
      pineconeStatus: {
        isConfigured: this.isPineconeReady,
        indexName: this.pineconeIndexName,
        totalVectors,
        dimension: 1024,
        metric: 'Cosine',
        embeddingModel: 'multilingual-e5-large',
        storageType: this.isPineconeReady
          ? 'Pinecone Serverless Cloud VectorDB'
          : 'Local In-Memory Vector Store (Normalized Cosine Similarity)',
      },
      metrics: {
        totalMemories: memories.length,
        episodicCount,
        semanticCount,
        reflexiveCount,
        solutionsCount,
        neuronCount: topology.length,
        axonsCount: Math.round(topology.length * 2.8),
        nerveTractsCount: nervePathways.length,
      },
      cognitiveClusters,
      recentThoughts,
      recentActivities,
      topology,
      nervePathways,
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
        const textToEmbed = `${saved.title}. ${memoryData.content}`;
        const embeddings = await this.pineconeClient.inference.embed({
          model: 'multilingual-e5-large',
          inputs: [textToEmbed],
          parameters: { input_type: 'passage', truncate: 'END' },
        });

        if (embeddings && embeddings.data && embeddings.data.length > 0) {
          const index = this.pineconeClient.index(this.pineconeIndexName);
          await index.upsert({
            records: [
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
            ],
          });
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
  /**
   * Defined White Matter Nerve Tracts / Pathways traversing directly through brain fissures and sulci
   */
  private generateNervePathways(agentCode: string): NervePathway[] {
    return [
      {
        id: 'corpus_callosum',
        name: 'Trans-Hemispheric Corpus Callosum Bridge',
        description: 'Deep commissural white matter tract bridging left and right cerebral hemispheres across the midline cleft',
        color: '#38bdf8',
        points: [
          { x: -0.78, y: 0.85, z: 0.15 },
          { x: -0.35, y: 0.95, z: 0.12 },
          { x: 0.0, y: 0.98, z: 0.10 },
          { x: 0.35, y: 0.95, z: 0.12 },
          { x: 0.78, y: 0.85, z: 0.15 },
        ],
      },
      {
        id: 'longitudinal_fissure_nerve',
        name: 'Longitudinal Fissure Dorsal Axis',
        description: 'Main central median nerve conduit traveling directly through the central longitudinal divide from anterior pole to posterior occiput',
        color: '#67e8f9',
        points: [
          { x: 0.0, y: 0.95, z: 1.55 },
          { x: 0.0, y: 1.45, z: 0.95 },
          { x: 0.0, y: 1.68, z: 0.10 },
          { x: 0.0, y: 1.55, z: -0.75 },
          { x: 0.0, y: 0.90, z: -1.55 },
        ],
      },
      {
        id: 'superior_longitudinal_left',
        name: 'Left Longitudinal Fasciculus',
        description: 'Major dorsal association tract running along the left superior gyri from frontal pole to occipital cortex',
        color: '#c084fc',
        points: [
          { x: -0.32, y: 0.95, z: 1.45 },
          { x: -0.65, y: 1.52, z: 0.65 },
          { x: -0.75, y: 1.62, z: -0.25 },
          { x: -0.62, y: 1.48, z: -0.95 },
          { x: -0.35, y: 0.85, z: -1.45 },
        ],
      },
      {
        id: 'superior_longitudinal_right',
        name: 'Right Longitudinal Fasciculus',
        description: 'Contralateral dorsal association tract running along the right superior gyri from frontal pole to occipital cortex',
        color: '#c084fc',
        points: [
          { x: 0.32, y: 0.95, z: 1.45 },
          { x: 0.65, y: 1.52, z: 0.65 },
          { x: 0.75, y: 1.62, z: -0.25 },
          { x: 0.62, y: 1.48, z: -0.95 },
          { x: 0.35, y: 0.85, z: -1.45 },
        ],
      },
      {
        id: 'lateral_sulcus_left',
        name: 'Left Sylvian / Lateral Sulcal Highway',
        description: 'Deep lateral fissure nerve bundle connecting the temporal lobe to prefrontal decision circuits',
        color: '#34d399',
        points: [
          { x: -0.42, y: 0.75, z: 1.15 },
          { x: -0.77, y: 1.01, z: 0.32 },
          { x: -1.05, y: 0.92, z: -0.25 },
          { x: -0.85, y: 0.55, z: -0.75 },
        ],
      },
      {
        id: 'lateral_sulcus_right',
        name: 'Right Sylvian / Lateral Sulcal Highway',
        description: 'Right lateral fissure conduit coordinating temporal episodic memory retrieval with central motor and parietal hubs',
        color: '#34d399',
        points: [
          { x: 0.42, y: 0.75, z: 1.15 },
          { x: 0.77, y: 1.01, z: 0.32 },
          { x: 1.05, y: 0.92, z: -0.25 },
          { x: 0.85, y: 0.55, z: -0.75 },
        ],
      },
      {
        id: 'precentral_crown_arch',
        name: 'Coronal Precentral Sulcal Arch',
        description: 'Bilateral coronal nerve arch sweeping across the top vertex crown between left and right motor regions',
        color: '#fbbf24',
        points: [
          { x: -0.95, y: 1.15, z: 0.05 },
          { x: -0.55, y: 1.62, z: 0.05 },
          { x: 0.0, y: 1.70, z: 0.05 },
          { x: 0.55, y: 1.62, z: 0.05 },
          { x: 0.95, y: 1.15, z: 0.05 },
        ],
      },
    ];
  }

  /**
   * Generate Anatomical 3D Neuron Topology Points snapped directly to cortical Gyri & Sulci folds
   */
  private generateNeuronTopology(agentCode: string, memories: AgentMemoryDocument[]): NeuronTopologyNode[] {
    const nodes: NeuronTopologyNode[] = [];
    const memoryCount = memories.length;

    // Load anatomical cortical gyri landmarks
    let gyriLandmarks: Array<{ name: string; x: number; y: number; z: number }> = [];
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const rawGyri = require('./anatomical_gyri.json');
      if (Array.isArray(rawGyri)) {
        gyriLandmarks = rawGyri.filter((g) => {
          const n = (g.name || '').toLowerCase();
          return (
            n.includes('gyrus') ||
            n.includes('sulcus') ||
            n.includes('pole') ||
            n.includes('fasciculus') ||
            n.includes('cerebell')
          );
        });
      }
    } catch {
      // Handled by procedural fallback coordinates below
    }

    const frontalGyri = gyriLandmarks.filter(
      (g) => g.name.toLowerCase().includes('frontal') || (g.z > 0.4 && g.y > 0.5)
    );
    const temporalGyri = gyriLandmarks.filter(
      (g) => g.name.toLowerCase().includes('temporal') || (Math.abs(g.x) > 0.65 && g.y < 0.9 && g.z > -0.6)
    );
    const parietalGyri = gyriLandmarks.filter(
      (g) => g.name.toLowerCase().includes('parietal') || (g.y > 1.2 && g.z <= 0.4 && g.z > -1.0)
    );
    const cerebellarGyri = gyriLandmarks.filter(
      (g) => g.name.toLowerCase().includes('cerebell') || g.name.toLowerCase().includes('occipital') || g.z <= -0.7
    );

    // Helper to generate a deterministic 8-dimension pseudo-random sample embedding vector preview
    const generateVectorPreview = (seedStr: string): number[] => {
      let hash = 0;
      for (let i = 0; i < seedStr.length; i++) {
        hash = (hash << 5) - hash + seedStr.charCodeAt(i);
        hash |= 0;
      }
      const vec: number[] = [];
      for (let d = 0; d < 8; d++) {
        const val = Math.sin(hash + (d + 1) * 1.6180339887);
        vec.push(parseFloat(val.toFixed(3)));
      }
      return vec;
    };

    // 1. Plant dedicated neurons for the agent's real stored memories snapped directly to anatomical gyri
    memories.forEach((mem, idx) => {
      let lobe: string;
      let x = 0, y = 0, z = 0;
      let gyrusName = '';

      switch (mem.memoryType) {
        case MemoryType.SOLUTION_KNOWLEDGE: {
          lobe = 'Frontal (Executive)';
          const g = frontalGyri.length > 0 ? frontalGyri[idx % frontalGyri.length] : null;
          if (g) {
            x = g.x;
            y = g.y;
            z = g.z;
            gyrusName = g.name;
          } else {
            const h = idx % 2 === 0 ? 1 : -1;
            x = 0.55 * h;
            y = 1.15;
            z = 1.1;
          }
          break;
        }
        case MemoryType.EPISODIC: {
          lobe = 'Temporal (Episodic Memory)';
          const g = temporalGyri.length > 0 ? temporalGyri[idx % temporalGyri.length] : null;
          if (g) {
            x = g.x;
            y = g.y;
            z = g.z;
            gyrusName = g.name;
          } else {
            const h = idx % 2 === 0 ? 1 : -1;
            x = 0.85 * h;
            y = 0.45;
            z = 0.2;
          }
          break;
        }
        case MemoryType.SEMANTIC: {
          lobe = 'Parietal (Semantic Knowledge)';
          const g = parietalGyri.length > 0 ? parietalGyri[idx % parietalGyri.length] : null;
          if (g) {
            x = g.x;
            y = g.y;
            z = g.z;
            gyrusName = g.name;
          } else {
            const h = idx % 2 === 0 ? 1 : -1;
            x = 0.45 * h;
            y = 1.55;
            z = -0.4;
          }
          break;
        }
        case MemoryType.REFLEXIVE:
        default: {
          lobe = 'Cerebellar (Reflexive Instincts)';
          const g = cerebellarGyri.length > 0 ? cerebellarGyri[idx % cerebellarGyri.length] : null;
          if (g) {
            x = g.x;
            y = g.y;
            z = g.z;
            gyrusName = g.name;
          } else {
            const h = idx % 2 === 0 ? 1 : -1;
            x = 0.55 * h;
            y = 0.45;
            z = -1.25;
          }
          break;
        }
      }

      nodes.push({
        id: `neuron_mem_${agentCode}_${mem._id}`,
        x: parseFloat(x.toFixed(3)),
        y: parseFloat(y.toFixed(3)),
        z: parseFloat(z.toFixed(3)),
        cluster: gyrusName || mem.title,
        intensity: parseFloat((0.8 + (mem.importanceScore / 35)).toFixed(2)),
        memoryId: (mem as any)._id.toString(),
        label: mem.title,
        lobe,
        type: mem.memoryType,
        vectorPreview: generateVectorPreview(mem.title + (mem.keywords?.join('') || '')),
      });
    });

    // 2. Anatomical somatic interneurons snapped directly to remaining gyri to form complete cortical network
    const totalNeuronTarget = Math.max(90, 50 + memoryCount * 5);
    const lobesMeta = [
      { name: 'Frontal (Executive)', type: MemoryType.SOLUTION_KNOWLEDGE, gyri: frontalGyri },
      { name: 'Temporal (Episodic Memory)', type: MemoryType.EPISODIC, gyri: temporalGyri },
      { name: 'Parietal (Semantic Knowledge)', type: MemoryType.SEMANTIC, gyri: parietalGyri },
      { name: 'Cerebellar (Reflexive Instincts)', type: MemoryType.REFLEXIVE, gyri: cerebellarGyri },
    ];

    for (let i = nodes.length; i < totalNeuronTarget; i++) {
      const lobeMeta = lobesMeta[i % lobesMeta.length];
      const gList = lobeMeta.gyri;
      let x = 0, y = 0, z = 0;
      let gyrusLabel = '';

      if (gList.length > 0) {
        const baseG = gList[i % gList.length];
        // Jitter slightly along the cortical sulcus fold so multiple somas can populate the same gyrus
        const jitter = (Math.sin(i * 3.7) * 0.05);
        x = baseG.x + jitter;
        y = baseG.y + (Math.cos(i * 2.3) * 0.04);
        z = baseG.z + (Math.sin(i * 1.9) * 0.05);
        gyrusLabel = baseG.name;
      } else {
        const hemisphere = i % 2 === 0 ? 1 : -1;
        x = 0.6 * hemisphere;
        y = 1.0;
        z = 0.0;
        gyrusLabel = `${lobeMeta.name} Fold`;
      }

      nodes.push({
        id: `neuron_${agentCode}_soma_${i}`,
        x: parseFloat(x.toFixed(3)),
        y: parseFloat(y.toFixed(3)),
        z: parseFloat(z.toFixed(3)),
        cluster: gyrusLabel || `${lobeMeta.name} Network`,
        intensity: parseFloat((0.45 + Math.random() * 0.5).toFixed(2)),
        label: `Synapse #${i + 1} (${gyrusLabel || lobeMeta.name})`,
        lobe: lobeMeta.name,
        type: lobeMeta.type,
        vectorPreview: generateVectorPreview(`${agentCode}_soma_${i}`),
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

  /**
   * Synchronize unindexed MongoDB memories to Pinecone vector store
   */
  async syncUnindexedMemories(): Promise<{ synced: number; total: number }> {
    if (!this.isPineconeReady || !this.pineconeClient) {
      return { synced: 0, total: 0 };
    }

    try {
      const unindexed = await this.memoryModel.find({ isIndexedInPinecone: { $ne: true } }).exec();
      if (unindexed.length === 0) {
        this.logger.log('All agent memories are already synced with Pinecone vector index.');
        return { synced: 0, total: 0 };
      }

      this.logger.log(
        `Syncing ${unindexed.length} unindexed agent memories to Pinecone index "${this.pineconeIndexName}"...`
      );
      const index = this.pineconeClient.index(this.pineconeIndexName);

      let syncedCount = 0;
      for (const memory of unindexed) {
        try {
          const textToEmbed = `${memory.title}. ${memory.content}`;
          const embeddings = await this.pineconeClient.inference.embed({
            model: 'multilingual-e5-large',
            inputs: [textToEmbed],
            parameters: { input_type: 'passage', truncate: 'END' },
          });

          if (embeddings?.data?.[0]?.values) {
            const pineconeId = memory.pineconeId || `mem_${memory.agentCode.toLowerCase()}_${memory._id}`;
            await index.upsert({
              records: [
                {
                  id: pineconeId,
                  values: embeddings.data[0].values,
                  metadata: {
                    mongoId: (memory as any)._id.toString(),
                    agentCode: memory.agentCode,
                    title: memory.title,
                    memoryType: memory.memoryType,
                    importance: memory.importanceScore,
                  },
                },
              ],
            });

            memory.pineconeId = pineconeId;
            memory.isIndexedInPinecone = true;
            await memory.save();
            syncedCount++;
          }
        } catch (innerErr: any) {
          this.logger.warn(`Failed to sync memory "${memory.title}" to Pinecone: ${innerErr.message}`);
        }
      }

      this.logger.log(`Successfully synced ${syncedCount}/${unindexed.length} memories to Pinecone vector index.`);
      return { synced: syncedCount, total: unindexed.length };
    } catch (err: any) {
      this.logger.error(`Error during Pinecone memory sync: ${err.message}`);
      return { synced: 0, total: 0 };
    }
  }
}
