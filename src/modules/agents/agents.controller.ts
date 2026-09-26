import { Controller, Get, Post, Param, Query, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AgentsService } from './agents.service';
import { AgentMemoryService } from './agent-memory.service';

@Controller('agents')
export class AgentsController {
  constructor(
    private readonly agentsService: AgentsService,
    private readonly memoryService: AgentMemoryService,
  ) {}

  @Get('view')
  findAll() {
    return this.agentsService.findAll();
  }

  @Get('view/:code')
  findOne(@Param('code') code: string) {
    return this.agentsService.findByCode(code.toUpperCase());
  }

  /**
   * Cognitive Brain State & 3D Neuron Topology for an Agent Organism
   */
  @Get(':code/brain')
  getBrainState(@Param('code') code: string) {
    return this.memoryService.getBrainState(code.toUpperCase());
  }

  /**
   * Stored space memories for an Agent Organism
   */
  @Get(':code/memories')
  getMemories(
    @Param('code') code: string,
    @Query('type') type?: string,
  ) {
    return this.memoryService.getMemories(code.toUpperCase(), type);
  }

  /**
   * Add a new memory or reflection to this Agent's space memory
   */
  @Post(':code/memories')
  @HttpCode(HttpStatus.CREATED)
  addMemory(
    @Param('code') code: string,
    @Body() memoryData: any,
  ) {
    return this.memoryService.addMemory(code.toUpperCase(), memoryData);
  }

  /**
   * Search Agent's space memory using RAG (Pinecone / MongoDB semantic search)
   */
  @Post(':code/memories/search')
  @HttpCode(HttpStatus.OK)
  searchRAG(
    @Param('code') code: string,
    @Body('query') query: string,
    @Body('topK') topK?: number,
  ) {
    return this.memoryService.searchMemories(code.toUpperCase(), query, topK || 5);
  }

  /**
   * Manually trigger synchronization of unindexed memories to Pinecone vector database
   */
  @Post('pinecone/sync')
  @HttpCode(HttpStatus.OK)
  syncPinecone() {
    return this.memoryService.syncUnindexedMemories();
  }
}

