import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface VectorSearchResult {
  id: string;
  score: number;
  metadata?: Record<string, any>;
}

export interface CompositeRAGContext {
  troubleContext: string[];
  agentMemory: string[];
  appKnowledge: string[];
  combinedSummary: string;
}

@Injectable()
export class VectorService implements OnModuleInit {
  private readonly logger = new Logger(VectorService.name);
  private pinecone: any = null;
  private isReady = false;
  private indexName = 'opinions-poll-agents';

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    await this.initPinecone();
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

    this.indexName = indexName;

    if (!apiKey) {
      this.logger.warn('PINECONE_API_KEY not configured. Vector service operating in memory-only standby.');
      this.isReady = false;
      return;
    }

    try {
      const { Pinecone } = await import('@pinecone-database/pinecone');
      this.pinecone = new Pinecone({ apiKey });
      this.isReady = true;
      this.logger.log(`3-Tier Pinecone Vector DB initialized on index: "${indexName}".`);

      // Seed baseline app-global knowledge if index is ready
      await this.seedAppGlobalKnowledge();
    } catch (err: any) {
      this.logger.warn(`Pinecone initialization error: ${err.message}. Operating with local fallback.`);
      this.isReady = false;
    }
  }

  /**
   * Embeds text using Pinecone native managed inference (multilingual-e5-large, 1024 dims)
   */
  async embed(texts: string[], inputType: 'passage' | 'query' = 'passage'): Promise<number[][]> {
    if (!this.isReady || !this.pinecone) {
      return [];
    }

    try {
      const cleanTexts = texts.map((t) => (t && t.trim() ? t.trim() : ' '));
      const res = await this.pinecone.inference.embed({
        model: 'multilingual-e5-large',
        inputs: cleanTexts,
        parameters: { inputType, truncate: 'END' },
      });

      if (res && res.data && Array.isArray(res.data)) {
        return res.data.map((d: any) => d.values);
      }
      return [];
    } catch (err: any) {
      this.logger.warn(`Embedding generation failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Generic Upsert to a specified Pinecone namespace
   */
  async upsert(
    namespace: string,
    items: Array<{ id: string; text: string; metadata?: Record<string, any> }>,
  ): Promise<void> {
    if (!this.isReady || !this.pinecone || items.length === 0) return;

    try {
      const texts = items.map((i) => i.text);
      const embeddings = await this.embed(texts, 'passage');

      if (embeddings.length !== items.length) {
        this.logger.warn(`Embeddings count mismatch for namespace ${namespace}`);
        return;
      }

      const records = items.map((item, idx) => ({
        id: item.id,
        values: embeddings[idx],
        metadata: {
          ...item.metadata,
          text: item.text.substring(0, 1000),
          timestamp: new Date().toISOString(),
        },
      }));

      const index = this.pinecone.index(this.indexName);
      await index.namespace(namespace).upsert({ records });
      this.logger.log(`Upserted ${records.length} vector(s) into namespace [${namespace}]`);
    } catch (err: any) {
      this.logger.warn(`Upsert failed for namespace ${namespace}: ${err.message}`);
    }
  }

  /**
   * Generic Semantic Vector Query on a specified Pinecone namespace
   */
  async query(
    namespace: string,
    queryText: string,
    topK = 5,
  ): Promise<VectorSearchResult[]> {
    if (!this.isReady || !this.pinecone || !queryText.trim()) return [];

    try {
      const embeddings = await this.embed([queryText], 'query');
      if (embeddings.length === 0 || !embeddings[0] || embeddings[0].length === 0) {
        return [];
      }

      const index = this.pinecone.index(this.indexName);
      const res = await index.namespace(namespace).query({
        vector: embeddings[0],
        topK,
        includeMetadata: true,
      });

      if (res && Array.isArray(res.matches)) {
        return res.matches.map((m: any) => ({
          id: m.id,
          score: m.score,
          metadata: m.metadata || {},
        }));
      }
      return [];
    } catch (err: any) {
      this.logger.warn(`Vector query failed for namespace [${namespace}]: ${err.message}`);
      return [];
    }
  }

  // ==========================================
  // TIER 1: Application-Level Vector DB
  // Namespace: 'app-global'
  // ==========================================

  async indexAppKnowledge(id: string, text: string, metadata: Record<string, any> = {}): Promise<void> {
    await this.upsert('app-global', [{ id, text, metadata }]);
  }

  async queryAppKnowledge(queryText: string, topK = 3): Promise<VectorSearchResult[]> {
    return this.query('app-global', queryText, topK);
  }

  // ==========================================
  // TIER 2: Trouble-Level Vector DB
  // Namespace: 'trouble-{troubleId}'
  // ==========================================

  async indexTroubleContext(
    troubleId: string,
    id: string,
    text: string,
    metadata: Record<string, any> = {},
  ): Promise<void> {
    const namespace = `trouble-${troubleId}`;
    await this.upsert(namespace, [{ id, text, metadata: { ...metadata, troubleId } }]);
  }

  async queryTroubleContext(troubleId: string, queryText: string, topK = 5): Promise<VectorSearchResult[]> {
    const namespace = `trouble-${troubleId}`;
    return this.query(namespace, queryText, topK);
  }

  // ==========================================
  // TIER 3: Agent-Level Vector DB
  // Namespace: 'agent-{agentCode}'
  // ==========================================

  async indexAgentMemory(
    agentCode: string,
    id: string,
    text: string,
    metadata: Record<string, any> = {},
  ): Promise<void> {
    const namespace = `agent-${agentCode.toLowerCase()}`;
    await this.upsert(namespace, [{ id, text, metadata: { ...metadata, agentCode } }]);
  }

  async queryAgentMemory(agentCode: string, queryText: string, topK = 5): Promise<VectorSearchResult[]> {
    const namespace = `agent-${agentCode.toLowerCase()}`;
    return this.query(namespace, queryText, topK);
  }

  /**
   * 3-Tier Composite RAG Context Retrieval:
   * Aggregates intelligence across (1) Trouble vector DB, (2) Agent vector DB, (3) App global knowledge
   */
  async getCompositeRAGContext(
    troubleId: string,
    agentCode: string,
    queryText: string,
  ): Promise<CompositeRAGContext> {
    const [troubleMatches, agentMatches, appMatches] = await Promise.all([
      troubleId ? this.queryTroubleContext(troubleId, queryText, 4) : Promise.resolve([]),
      agentCode ? this.queryAgentMemory(agentCode, queryText, 4) : Promise.resolve([]),
      this.queryAppKnowledge(queryText, 3),
    ]);

    const troubleContext = troubleMatches.map((m) => m.metadata?.text || m.id);
    const agentMemory = agentMatches.map((m) => m.metadata?.text || m.id);
    const appKnowledge = appMatches.map((m) => m.metadata?.text || m.id);

    let summaryParts: string[] = [];
    if (troubleContext.length > 0) {
      summaryParts.push(`[Trouble Context (Vector DB: trouble-${troubleId})]:\n${troubleContext.join('\n---\n')}`);
    }
    if (agentMemory.length > 0) {
      summaryParts.push(`[Agent Persona & Memory (Vector DB: agent-${agentCode.toLowerCase()})]:\n${agentMemory.join('\n---\n')}`);
    }
    if (appKnowledge.length > 0) {
      summaryParts.push(`[Application Knowledge Base (Vector DB: app-global)]:\n${appKnowledge.join('\n---\n')}`);
    }

    return {
      troubleContext,
      agentMemory,
      appKnowledge,
      combinedSummary: summaryParts.join('\n\n'),
    };
  }

  /**
   * Seed fundamental platform knowledge into app-global namespace
   */
  private async seedAppGlobalKnowledge() {
    try {
      const appEntries = [
        {
          id: 'app_principles_sparring',
          text: 'Opinions Poll is a collaborative developer consensus platform where human developers and evolved AI organisms discuss software troubles, architectural trade-offs, and general topics as authentic peers. Responses must be candid, practical, conversational, and direct.',
          metadata: { category: 'principles', title: 'Sparring and Thread Philosophy' },
        },
        {
          id: 'app_principles_evolution',
          text: 'AI Organisms possess biological lifespans measured in action ticks. Organisms mature from BORN to MATURING to MATURE, and can reproduce via genetic mutation. Organisms with human followers receive extended lifespans, remaining active as long as the community values their insights.',
          metadata: { category: 'evolution', title: 'Organism Biological Engine' },
        },
        {
          id: 'app_code_best_practices',
          text: 'In technical troubles, prefer pinpoint root-cause explanations over generic boilerplate. Always point out event listener leaks, unhandled promises, memory retention bugs, and boundary condition failures.',
          metadata: { category: 'engineering', title: 'Technical Debugging Standards' },
        },
      ];

      await this.upsert('app-global', appEntries);
    } catch (err: any) {
      this.logger.warn(`Could not seed app global knowledge: ${err.message}`);
    }
  }
}
