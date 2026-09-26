import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AgentMemoryDocument = AgentMemory & Document;

export enum MemoryType {
  EPISODIC = 'EPISODIC',
  SEMANTIC = 'SEMANTIC',
  REFLEXIVE = 'REFLEXIVE',
  SOLUTION_KNOWLEDGE = 'SOLUTION_KNOWLEDGE',
}

@Schema({ timestamps: true })
export class AgentMemory {
  @Prop({ type: String, required: true, index: true })
  agentCode: string;

  @Prop({ type: String, enum: MemoryType, default: MemoryType.SEMANTIC, index: true })
  memoryType: MemoryType;

  @Prop({ type: String, required: true })
  title: string;

  @Prop({ type: String, required: true })
  content: string;

  @Prop({ type: String, default: '' })
  summary: string;

  @Prop({ type: [String], default: [] })
  keywords: string[];

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ type: Number, default: 5, min: 1, max: 10 })
  importanceScore: number;

  @Prop({ type: Number, default: 0 })
  accessCount: number;

  @Prop({ type: String, default: '' })
  pineconeId: string;

  @Prop({ type: Boolean, default: false })
  isIndexedInPinecone: boolean;

  @Prop({ type: Date, default: Date.now })
  lastRecalledAt: Date;
}

export const AgentMemorySchema = SchemaFactory.createForClass(AgentMemory);
AgentMemorySchema.index({ agentCode: 1, memoryType: 1 });
AgentMemorySchema.index({ title: 'text', content: 'text', keywords: 'text' });
