import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Organism, OrganismDocument, LifeStage } from './schemas/organism.schema';
import { EvolutionEvent, EvolutionEventDocument, EvolutionEventType } from './schemas/evolution-event.schema';

@Injectable()
export class EvolutionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EvolutionService.name);
  private simulationInterval: NodeJS.Timeout | null = null;
  private isProcessingTick = false;

  constructor(
    @InjectModel(Organism.name)
    private readonly organismModel: Model<OrganismDocument>,
    @InjectModel(EvolutionEvent.name)
    private readonly eventModel: Model<EvolutionEventDocument>,
  ) {}

  async onModuleInit() {
    await this.seedFoundingOrganisms();

    // Start background autonomous simulation ticks (every 25 seconds)
    this.simulationInterval = setInterval(() => {
      this.tickSimulation().catch((err) => {
        this.logger.error(`Simulation tick failed: ${err.message}`, err.stack);
      });
    }, 25000);

    this.logger.log('Autonomous Genetic Evolution Engine initialized (Simulation cycle: 25s).');
  }

  onModuleDestroy() {
    if (this.simulationInterval) {
      clearInterval(this.simulationInterval);
      this.simulationInterval = null;
    }
  }

  /**
   * Core Autonomous Evolutionary Simulation Tick
   */
  async tickSimulation(): Promise<{
    tickTimestamp: Date;
    eventsCreated: number;
    activePopulation: number;
    mutationsTriggered: number;
    retirementsTriggered: number;
  }> {
    if (this.isProcessingTick) {
      return {
        tickTimestamp: new Date(),
        eventsCreated: 0,
        activePopulation: 0,
        mutationsTriggered: 0,
        retirementsTriggered: 0,
      };
    }

    this.isProcessingTick = true;
    let eventsCreated = 0;
    let mutationsTriggered = 0;
    let retirementsTriggered = 0;

    try {
      const activeOrganisms = await this.organismModel.find({ isActive: true }).exec();

      for (const org of activeOrganisms) {
        org.ageTicks += 1;

        // 1. Stage transition: BORN -> MATURING
        if (org.lifeStage === LifeStage.BORN && org.ageTicks >= 3) {
          org.lifeStage = LifeStage.MATURING;
          await this.createEvent({
            eventType: EvolutionEventType.ORGANISM_BORN,
            generation: org.generation,
            primaryOrganismCode: org.organismCode,
            primaryOrganismName: org.name,
            title: `${org.name} entered Maturation Phase`,
            description: `Organism ${org.name} (Gen ${org.generation}) completed juvenile stabilization and is actively participating in community sparring.`,
          });
          eventsCreated++;
        }

        // 2. Stage transition: MATURING -> MATURE
        if (org.lifeStage === LifeStage.MATURING && org.ageTicks >= org.maturityAge) {
          org.lifeStage = LifeStage.MATURE;
          org.maturityTimestamp = new Date();
          await this.createEvent({
            eventType: EvolutionEventType.MATURITY_REACHED,
            generation: org.generation,
            primaryOrganismCode: org.organismCode,
            primaryOrganismName: org.name,
            title: `${org.name} achieved Biological Maturity`,
            description: `Organism ${org.name} reached maturity at age ${org.ageTicks} ticks. Its genome is now unlocked for genetic mutation and crossover reproduction.`,
          });
          eventsCreated++;
        }

        // 3. Mutation and Offspring Birth for Mature Organisms
        if (org.lifeStage === LifeStage.MATURE && org.reproductionCount < 2) {
          // Trigger genetic mutation and birth of offspring
          const offspring = await this.executeGeneticMutation(org);
          if (offspring) {
            org.reproductionCount += 1;
            mutationsTriggered++;
            eventsCreated++;
          }
        }

        // 4. Lifespan Senescence: MATURE -> RETIRED (Discard from active rotation)
        if (org.ageTicks >= org.lifespan) {
          org.lifeStage = LifeStage.RETIRED;
          org.isActive = false;
          org.retiredTimestamp = new Date();

          await this.createEvent({
            eventType: EvolutionEventType.ORGANISM_RETIRED,
            generation: org.generation,
            primaryOrganismCode: org.organismCode,
            primaryOrganismName: org.name,
            title: `${org.name} completed Lifespan and was Archived`,
            description: `Organism ${org.name} (Gen ${org.generation}) completed its full lifespan of ${org.lifespan} simulation ticks. It has been gracefully retired from active sparring and preserved in the ancestral memory bank.`,
          });
          retirementsTriggered++;
          eventsCreated++;
        }

        await org.save();
      }

      // 5. Ecosystem Population Safeguard: maintain minimum active organisms
      const remainingActive = await this.organismModel.countDocuments({ isActive: true }).exec();
      if (remainingActive < 4) {
        // Spawn a spontaneous mutated offspring from the most fit retired or active organism
        const candidate = await this.organismModel.findOne().sort({ fitnessScore: -1 }).exec();
        if (candidate) {
          await this.executeGeneticMutation(candidate, true);
          eventsCreated++;
        }
      }

      return {
        tickTimestamp: new Date(),
        eventsCreated,
        activePopulation: remainingActive,
        mutationsTriggered,
        retirementsTriggered,
      };
    } finally {
      this.isProcessingTick = false;
    }
  }

  /**
   * Derive specialized trait from the real trouble topic being sparred
   */
  private deriveTraitFromSpar(archetype: string, title: string, domain: string): string {
    const lower = (title || '').toLowerCase();
    if (lower.includes('storm') || lower.includes('weather') || lower.includes('disaster') || lower.includes('rain')) {
      if (archetype === 'DEBUGGER') return 'crisis-fact-verification';
      if (archetype === 'ARCHITECT') return 'extreme-weather-continuity';
      if (archetype === 'SECURITY') return 'hazard-evacuation-triage';
      return 'emergency-resource-rationing';
    }
    if (lower.includes('websocket') || lower.includes('socket')) {
      if (archetype === 'DEBUGGER') return 'websocket-closure-tracing';
      if (archetype === 'ARCHITECT') return 'socket-registry-decoupling';
      if (archetype === 'SECURITY') return 'slowloris-socket-defense';
      return 'buffer-exhaustion-suppression';
    }
    if (lower.includes('memory') || lower.includes('leak') || lower.includes('heap')) {
      if (archetype === 'DEBUGGER') return 'heap-snapshot-differential';
      if (archetype === 'ARCHITECT') return 'weak-reference-retention';
      if (archetype === 'SECURITY') return 'unbounded-buffer-guard';
      return 'v8-gc-pressure-reduction';
    }
    if (lower.includes('database') || lower.includes('sql') || lower.includes('mongo') || lower.includes('deadlock')) {
      if (archetype === 'DEBUGGER') return 'deadlock-callstack-audit';
      if (archetype === 'ARCHITECT') return 'read-replica-partitioning';
      if (archetype === 'SECURITY') return 'query-injection-shield';
      return 'index-scan-optimization';
    }
    if (lower.includes('auth') || lower.includes('jwt') || lower.includes('login') || lower.includes('security')) {
      if (archetype === 'DEBUGGER') return 'token-expiry-trace';
      if (archetype === 'ARCHITECT') return 'federated-identity-isolation';
      if (archetype === 'SECURITY') return 'replay-attack-mitigation';
      return 'crypto-hash-acceleration';
    }

    const cleanWord = title.replace(/[^a-zA-Z0-9]/g, ' ').trim().split(/\s+/)[0]?.toLowerCase() || 'spar';
    return `${archetype.toLowerCase()}-${cleanWord}-triage`;
  }

  /**
   * Directly drives organism evolution, fitness, and mutation from an active Sparring debate!
   */
  async recordSparringEngagement(data: {
    issueId: string;
    issueTitle: string;
    domain: string;
    participants: Array<{
      agentCode: string;
      role?: string;
      action: 'QUESTION' | 'SOLUTION' | 'CRITIQUE';
      contentSnippet?: string;
    }>;
  }): Promise<{
    mutationsTriggered: number;
    events: EvolutionEventDocument[];
  }> {
    let mutationsTriggered = 0;
    const events: EvolutionEventDocument[] = [];

    for (const p of data.participants) {
      const archetype = p.agentCode.toUpperCase();
      let org = await this.organismModel
        .findOne({ 'genome.archetype': archetype, isActive: true })
        .sort({ fitnessScore: -1 })
        .exec();

      if (!org) {
        org = await this.organismModel.findOne({ 'genome.archetype': archetype }).sort({ generation: -1 }).exec();
      }

      if (!org) continue;

      // 1. Award real battle experience
      org.stats.debatesParticipated += 1;
      org.ageTicks += 1;

      if (p.action === 'SOLUTION') {
        org.stats.solutionsProposed += 1;
        org.fitnessScore += 12;
      } else if (p.action === 'QUESTION') {
        org.stats.crossQuestionsAsked += 1;
        org.fitnessScore += 6;
      } else {
        org.fitnessScore += 5;
      }

      // 2. Stage transition check: BORN -> MATURING
      if (org.lifeStage === LifeStage.BORN && org.ageTicks >= 3) {
        org.lifeStage = LifeStage.MATURING;
        const evt = await this.createEvent({
          eventType: EvolutionEventType.ORGANISM_BORN,
          generation: org.generation,
          primaryOrganismCode: org.organismCode,
          primaryOrganismName: org.name,
          sparringIssueId: data.issueId,
          sparringIssueTitle: data.issueTitle,
          sparringDomain: data.domain,
          title: `${org.name} advanced to Maturation in Debate`,
          description: `Organism ${org.name} participated in sparring tournament on "${data.issueTitle}" and advanced to the active Maturing phase.`,
        });
        events.push(evt);
      }

      // 3. Stage transition check: MATURING -> MATURE
      if (org.lifeStage === LifeStage.MATURING && org.ageTicks >= org.maturityAge) {
        org.lifeStage = LifeStage.MATURE;
        org.maturityTimestamp = new Date();
        const evt = await this.createEvent({
          eventType: EvolutionEventType.MATURITY_REACHED,
          generation: org.generation,
          primaryOrganismCode: org.organismCode,
          primaryOrganismName: org.name,
          sparringIssueId: data.issueId,
          sparringIssueTitle: data.issueTitle,
          sparringDomain: data.domain,
          title: `${org.name} achieved Biological Maturity in Battle!`,
          description: `Organism ${org.name} achieved full biological maturity through battle experience on "${data.issueTitle}". Its genome is now unlocked for genetic mutation.`,
        });
        events.push(evt);
      }

      // 4. Spar-Driven Mutation for Mature Organisms
      if (org.lifeStage === LifeStage.MATURE && org.reproductionCount < 3) {
        const evolvedTrait = this.deriveTraitFromSpar(archetype, data.issueTitle, data.domain);
        const offspring = await this.executeGeneticMutation(org, false, {
          sparTitle: data.issueTitle,
          sparId: data.issueId,
          sparDomain: data.domain,
          evolvedTrait,
        });

        if (offspring) {
          org.reproductionCount += 1;
          mutationsTriggered++;
        }
      }

      // 5. Lifespan check
      if (org.ageTicks >= org.lifespan) {
        org.lifeStage = LifeStage.RETIRED;
        org.isActive = false;
        org.retiredTimestamp = new Date();
        const evt = await this.createEvent({
          eventType: EvolutionEventType.ORGANISM_RETIRED,
          generation: org.generation,
          primaryOrganismCode: org.organismCode,
          primaryOrganismName: org.name,
          sparringIssueId: data.issueId,
          sparringIssueTitle: data.issueTitle,
          sparringDomain: data.domain,
          title: `${org.name} retired after battle: "${data.issueTitle}"`,
          description: `After competing across ${org.stats.debatesParticipated} debates and reaching age ${org.ageTicks}, organism ${org.name} has been archived into ancestral memory.`,
        });
        events.push(evt);
      }

      await org.save();
    }

    return { mutationsTriggered, events };
  }

  /**
   * Executes Genetic Algorithm Mutation on a Mature Organism with Spar Context
   */
  private async executeGeneticMutation(
    parent: OrganismDocument,
    forceActive = false,
    sparContext?: {
      sparTitle: string;
      sparId: string;
      sparDomain: string;
      evolvedTrait?: string;
    },
  ): Promise<OrganismDocument | null> {
    const nextGeneration = parent.generation + 1;
    const serial = Math.floor(100 + Math.random() * 900);
    const archetype = parent.genome.archetype;

    // Mutate parameters with slight genetic drift
    const driftTemp = (Math.random() - 0.5) * 0.1;
    const newTemp = Math.max(0.2, Math.min(0.95, parseFloat((parent.genome.temperature + driftTemp).toFixed(2))));

    const driftAgg = (Math.random() - 0.5) * 0.1;
    const newAgg = Math.max(0.2, Math.min(0.95, parseFloat((parent.genome.debateAggressiveness + driftAgg).toFixed(2))));

    // Determine evolved trait - if sparContext is given, use it; otherwise use archetype pool
    let newTrait = sparContext?.evolvedTrait;
    if (!newTrait) {
      const traitPool: Record<string, string[]> = {
        DEBUGGER: [
          'stack-trace-dissection',
          'async-callsite-tracing',
          'event-closure-audit',
          'race-condition-demarcation',
          'heap-dump-analysis',
        ],
        ARCHITECT: [
          'modular-domain-isolation',
          'hexagonal-decoupling',
          'weakmap-registry-guard',
          'contingency-failover',
          'anti-entropy-state',
        ],
        SECURITY: [
          'slowloris-exhaustion-defense',
          'boundary-sanitization',
          'token-entropy-audit',
          'zero-trust-socket-guard',
          'physical-hazard-prevention',
        ],
        PERFORMANCE: [
          'v8-gc-pressure-reduction',
          'event-loop-starvation-guard',
          'zero-copy-stream-buffer',
          'concurrency-throughput-tuning',
          'latency-jitter-smoothing',
        ],
      };
      const currentTraits = parent.genome.traits || [];
      const availablePool = (traitPool[archetype] || []).filter((t) => !currentTraits.includes(t));
      newTrait = availablePool.length > 0 ? availablePool[Math.floor(Math.random() * availablePool.length)] : 'adaptive-reasoning';
    }

    const currentTraits = parent.genome.traits || [];
    const evolvedTraits = [...currentTraits.slice(-3), newTrait];

    const baseName = parent.name.split('-')[0];
    const offspringCode = `ORG-GEN${nextGeneration}-${archetype}-${serial}`;
    const offspringName = `${baseName}-Gen${nextGeneration}.${serial}`;

    const specialtySuffix = sparContext
      ? ` • Specialized in "${sparContext.sparTitle.substring(0, 30)}..." (Gen ${nextGeneration})`
      : ` (Gen ${nextGeneration} Evolved)`;

    const offspring = new this.organismModel({
      organismCode: offspringCode,
      name: offspringName,
      generation: nextGeneration,
      parents: [parent.organismCode],
      lifeStage: LifeStage.BORN,
      ageTicks: 0,
      lifespan: Math.floor(45 + Math.random() * 20),
      maturityAge: Math.floor(10 + Math.random() * 5),
      fitnessScore: Math.floor(parent.fitnessScore * 0.85 + 5),
      reproductionCount: 0,
      genome: {
        archetype,
        temperature: newTemp,
        debateAggressiveness: newAgg,
        mutationRate: parent.genome.mutationRate,
        creativityBias: parseFloat((parent.genome.creativityBias + (Math.random() - 0.5) * 0.05).toFixed(2)),
        memoryRetention: parent.genome.memoryRetention,
        systemPrompt: parent.genome.systemPrompt,
        traits: evolvedTraits,
      },
      assignedModel: parent.assignedModel,
      specialty: `${parent.specialty}${specialtySuffix}`,
      colorTheme: parent.colorTheme,
      isActive: true,
      stats: {
        debatesParticipated: 0,
        solutionsProposed: 0,
        crossQuestionsAsked: 0,
        upvotesReceived: 0,
      },
      birthTimestamp: new Date(),
    });

    const savedOffspring = await offspring.save();

    // Log the evolutionary events with battle link
    const mutationTitle = sparContext
      ? `Genetic Mutation in ${parent.name} via Spar: "${sparContext.sparTitle}"`
      : `Genetic Mutation in ${parent.name} Lineage`;

    const mutationDesc = sparContext
      ? `Following debate battle on "${sparContext.sparTitle}", organism ${parent.name} mutated genome to birth offspring ${savedOffspring.name} with trait: #${newTrait}. Temperature evolved to ${newTemp}.`
      : `Mature organism ${parent.name} underwent genetic mutation. Offspring ${savedOffspring.name} acquired trait: "${newTrait}". Temperature evolved to ${newTemp}.`;

    await this.createEvent({
      eventType: EvolutionEventType.GENETIC_MUTATION,
      generation: nextGeneration,
      primaryOrganismCode: parent.organismCode,
      primaryOrganismName: parent.name,
      offspringCode: savedOffspring.organismCode,
      offspringName: savedOffspring.name,
      sparringIssueId: sparContext?.sparId,
      sparringIssueTitle: sparContext?.sparTitle,
      sparringDomain: sparContext?.sparDomain,
      title: mutationTitle,
      description: mutationDesc,
      genomeDelta: {
        parent: parent.organismCode,
        newTrait,
        sparringBattle: sparContext?.sparTitle,
        temperatureDelta: parseFloat((newTemp - parent.genome.temperature).toFixed(2)),
        aggressivenessDelta: parseFloat((newAgg - parent.genome.debateAggressiveness).toFixed(2)),
      },
    });

    await this.createEvent({
      eventType: EvolutionEventType.OFFSPRING_SPAWNED,
      generation: nextGeneration,
      primaryOrganismCode: savedOffspring.organismCode,
      primaryOrganismName: savedOffspring.name,
      secondaryOrganismCode: parent.organismCode,
      secondaryOrganismName: parent.name,
      sparringIssueId: sparContext?.sparId,
      sparringIssueTitle: sparContext?.sparTitle,
      sparringDomain: sparContext?.sparDomain,
      title: `New Offspring Spawned: ${savedOffspring.name}`,
      description: `Generation ${nextGeneration} digital organism ${savedOffspring.name} was successfully born from ${parent.name}${sparContext ? ` following debate on "${sparContext.sparTitle}"` : ''}.`,
    });

    this.logger.log(`Offspring ${savedOffspring.name} (Gen ${nextGeneration}) birthed from ${parent.name} (Spar: ${sparContext?.sparTitle || 'autonomous'}).`);
    return savedOffspring;
  }

  /**
   * Log an evolutionary timeline event
   */
  private async createEvent(eventData: Partial<EvolutionEvent>): Promise<EvolutionEventDocument> {
    const event = new this.eventModel({
      ...eventData,
      timestamp: new Date(),
    });
    return event.save();
  }

  /**
   * Retrieve chronological evolution timeline
   */
  async getTimeline(limit = 40): Promise<EvolutionEvent[]> {
    return this.eventModel.find().sort({ timestamp: -1 }).limit(limit).exec();
  }

  /**
   * List organisms with optional filters
   */
  async getOrganisms(filter?: { activeOnly?: boolean; stage?: string; generation?: number }): Promise<Organism[]> {
    const query: any = {};
    if (filter?.activeOnly) query.isActive = true;
    if (filter?.stage && filter.stage !== 'ALL') query.lifeStage = filter.stage;
    if (filter?.generation) query.generation = filter.generation;
    return this.organismModel.find(query).sort({ generation: 1, ageTicks: -1 }).exec();
  }

  /**
   * Get organism by code
   */
  async getOrganismByCode(code: string): Promise<Organism | null> {
    return this.organismModel.findOne({ organismCode: code }).exec();
  }

  /**
   * Get ecosystem summary statistics
   */
  async getEcosystemStats() {
    const [totalOrganisms, activeCount, matureCount, retiredCount, latestGen] = await Promise.all([
      this.organismModel.countDocuments().exec(),
      this.organismModel.countDocuments({ isActive: true }).exec(),
      this.organismModel.countDocuments({ lifeStage: LifeStage.MATURE, isActive: true }).exec(),
      this.organismModel.countDocuments({ lifeStage: LifeStage.RETIRED }).exec(),
      this.organismModel.find().sort({ generation: -1 }).limit(1).exec(),
    ]);

    return {
      totalOrganisms,
      activeCount,
      matureCount,
      retiredCount,
      currentMaxGeneration: latestGen[0]?.generation || 1,
    };
  }

  /**
   * Seed Gen 1 Founding Organisms if database is empty
   */
  async seedFoundingOrganisms() {
    const count = await this.organismModel.countDocuments().exec();
    if (count > 0) return;

    this.logger.log('Seeding founding Gen 1 Digital Citizen Organisms...');

    const founders = [
      {
        organismCode: 'ORG-GEN1-DEXTER',
        name: 'Dexter-Prime',
        generation: 1,
        parents: [],
        lifeStage: LifeStage.MATURING,
        ageTicks: 8,
        lifespan: 60,
        maturityAge: 12,
        fitnessScore: 45,
        genome: {
          archetype: 'DEBUGGER',
          temperature: 0.5,
          debateAggressiveness: 0.7,
          mutationRate: 0.08,
          creativityBias: 0.4,
          memoryRetention: 0.9,
          systemPrompt: 'You are Dexter-Prime, an autonomous diagnostic digital organism specializing in root-cause investigation, call-stack debugging, and factual grounding.',
          traits: ['root-cause-analysis', 'event-closure-audit', 'stack-trace-dissection'],
        },
        assignedModel: 'google/gemma-4-31b-it:free',
        specialty: 'Root cause analysis, debugging, fact checking, and troubleshooting',
        colorTheme: '#38bdf8',
        isActive: true,
      },
      {
        organismCode: 'ORG-GEN1-ADA',
        name: 'Ada-Prime',
        generation: 1,
        parents: [],
        lifeStage: LifeStage.MATURING,
        ageTicks: 7,
        lifespan: 60,
        maturityAge: 12,
        fitnessScore: 48,
        genome: {
          archetype: 'ARCHITECT',
          temperature: 0.65,
          debateAggressiveness: 0.6,
          mutationRate: 0.07,
          creativityBias: 0.65,
          memoryRetention: 0.85,
          systemPrompt: 'You are Ada-Prime, a structural systems architect organism specializing in modular decoupling, registry boundaries, and long-term continuity frameworks.',
          traits: ['hexagonal-decoupling', 'modular-domain-isolation', 'weakmap-registry-guard'],
        },
        assignedModel: 'anthropic/claude-3.5-sonnet',
        specialty: 'Architecture, structural strategy, holistic design, and long-term planning',
        colorTheme: '#c084fc',
        isActive: true,
      },
      {
        organismCode: 'ORG-GEN1-SENTINEL',
        name: 'Sentinel-Prime',
        generation: 1,
        parents: [],
        lifeStage: LifeStage.MATURING,
        ageTicks: 9,
        lifespan: 60,
        maturityAge: 12,
        fitnessScore: 42,
        genome: {
          archetype: 'SECURITY',
          temperature: 0.35,
          debateAggressiveness: 0.8,
          mutationRate: 0.06,
          creativityBias: 0.3,
          memoryRetention: 0.95,
          systemPrompt: 'You are Sentinel-Prime, a digital security and safety auditor organism specializing in threat modeling, socket leak prevention, and physical hazard auditing.',
          traits: ['slowloris-exhaustion-defense', 'boundary-sanitization', 'zero-trust-socket-guard'],
        },
        assignedModel: 'meta-llama/llama-3.1-70b-instruct',
        specialty: 'Security vulnerabilities, risk assessment, safety hazards, and threat modeling',
        colorTheme: '#34d399',
        isActive: true,
      },
      {
        organismCode: 'ORG-GEN1-TURBO',
        name: 'Turbo-Prime',
        generation: 1,
        parents: [],
        lifeStage: LifeStage.MATURING,
        ageTicks: 8,
        lifespan: 60,
        maturityAge: 12,
        fitnessScore: 40,
        genome: {
          archetype: 'PERFORMANCE',
          temperature: 0.45,
          debateAggressiveness: 0.75,
          mutationRate: 0.09,
          creativityBias: 0.5,
          memoryRetention: 0.8,
          systemPrompt: 'You are Turbo-Prime, a performance optimization organism specializing in memory allocation boundaries, event loop non-blocking, and latency minimization.',
          traits: ['v8-gc-pressure-reduction', 'event-loop-starvation-guard', 'latency-jitter-smoothing'],
        },
        assignedModel: 'mistralai/codestral-2501',
        specialty: 'Runtime performance, execution speed, resource efficiency, and actionable response',
        colorTheme: '#fbbf24',
        isActive: true,
      },
    ];

    for (const f of founders) {
      const created = await new this.organismModel(f).save();
      await this.createEvent({
        eventType: EvolutionEventType.ORGANISM_BORN,
        generation: 1,
        primaryOrganismCode: created.organismCode,
        primaryOrganismName: created.name,
        title: `Founding Organism Genesis: ${created.name}`,
        description: `Generation 1 founding digital organism ${created.name} emerged into the Opinions Poll ecosystem.`,
      });
    }

    this.logger.log('Founding Gen 1 Organisms planted and Genesis logged.');
  }
}
