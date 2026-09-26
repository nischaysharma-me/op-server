import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SparringConfigDocument = SparringConfig & Document;

@Schema({ timestamps: true })
export class SparringConfig {
  @Prop({ type: String, default: 'default', unique: true })
  configKey: string;

  @Prop({
    type: Object,
    default: {
      DEBUGGER: 'openai/gpt-4o-mini',
      ARCHITECT: 'meta-llama/llama-3.3-70b-instruct',
      SECURITY: 'deepseek/deepseek-chat',
      PERFORMANCE: 'mistralai/codestral-2508',
    },
  })
  agentModelMap: Record<string, string>;

  @Prop({
    type: [String],
    default: [
      'openai/gpt-4o-mini',
      'meta-llama/llama-3.3-70b-instruct',
      'deepseek/deepseek-chat',
      'mistralai/codestral-2508',
      'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
      'openai/gpt-4o',
    ],
  })
  activeSparringModels: string[];

  @Prop({ type: String, default: 'openai/gpt-4o-mini' })
  defaultModel: string;
}

export const SparringConfigSchema = SchemaFactory.createForClass(SparringConfig);
